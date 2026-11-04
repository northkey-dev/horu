import { authHeaders, DEFAULT_SERVER, wsUrl, type Msg, type ServerConfig, type VideoDiag, type VideoState } from './messages.ts';

/** Where Horu runs: handed over by the service worker when recording starts (offscreen pages have no storage). */
let server: ServerConfig = { url: DEFAULT_SERVER, token: '' };
import type { ExtMomentMeta, ServerToExt } from '../../shared/types.ts';

// Offscreen document: records the tab audio into a rolling buffer, keeps the
// WebSocket to the Horu server and assembles a moment when the phone asks.

let ctx: AudioContext | undefined;
let stream: MediaStream | undefined;
let ring = new Float32Array(0);
let ringPos = 0; // next write index
let ringFilled = 0;
let ws: WebSocket | undefined;
let recording = false;
let reconnectTimer: number | undefined;

type TimedState = VideoState & { at: number; frameKey: string };
const videoStates = new Map<string, TimedState>();
const videoDiags = new Map<string, VideoDiag & { at: number }>();

/** Plain-language summary of what the frames contain (no addresses), shown when no video position was found. */
function describeVideos(now: number): string {
  const frames = [...videoDiags.values()].filter((d) => now - d.at < 6000);
  if (!frames.length) return 'No page frame answered (page blocks extensions, or the recording was started before the page finished loading).';
  const videos = frames.flatMap((f) => f.videos.map((v) => ({ ...v, top: f.top })));
  if (!videos.length) return `Found ${frames.length} frame(s) but no <video> element (the player may draw on a canvas or use a plugin).`;
  return videos
    .slice(0, 4)
    .map((v, i) => {
      const len = v.duration === null ? 'unknown length' : `${v.duration} s long`;
      const why = v.duration !== null && v.duration <= 30 ? ' – too short, treated as a preview' : v.readyState === 0 ? ' – not loaded yet' : '';
      return `video ${i + 1}: ${len}, ${v.width}x${v.height}, ${v.paused ? 'paused' : 'playing'}, source ${v.source}, ${v.top ? 'main page' : 'embedded frame'}${v.shadow ? ', inside shadow DOM' : ''}${why}`;
    })
    .join('; ');
}

const RING_SECONDS = 60;

async function startCapture(streamId: string): Promise<void> {
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } } as MediaTrackConstraints,
    video: false,
  });
  ctx = new AudioContext();
  // Offscreen pages have no user gesture; make sure the context actually runs.
  if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
  const source = ctx.createMediaStreamSource(stream);
  // Capturing a tab mutes it; route the audio back to the speakers/TV.
  source.connect(ctx.destination);
  await ctx.audioWorklet.addModule(chrome.runtime.getURL('worklet.js'));
  const tap = new AudioWorkletNode(ctx, 'ring-tap');
  ring = new Float32Array(Math.ceil(ctx.sampleRate * RING_SECONDS));
  ringPos = 0;
  ringFilled = 0;
  tap.port.onmessage = (e: MessageEvent<Float32Array>) => writeRing(e.data);
  source.connect(tap);
  stream.getAudioTracks()[0]?.addEventListener('ended', () => {
    stopCapture();
    chrome.runtime.sendMessage({ type: 'capture-stopped' } satisfies Msg).catch(() => {});
  });
  recording = true;
  connect();
}

function stopCapture(): void {
  recording = false;
  stream?.getTracks().forEach((t) => t.stop());
  void ctx?.close();
  ctx = undefined;
  stream = undefined;
  send({ type: 'recording', recording: false });
  ws?.close();
}

let lastSound = 0;

function writeRing(chunk: Float32Array): void {
  for (let i = 0; i < chunk.length; i += 64) {
    if (Math.abs(chunk[i]) > 0.005) {
      lastSound = performance.now();
      break;
    }
  }
  for (let i = 0; i < chunk.length; i++) {
    ring[ringPos] = chunk[i];
    ringPos = (ringPos + 1) % ring.length;
  }
  ringFilled = Math.min(ring.length, ringFilled + chunk.length);
}

/** The newest `count` samples (or fewer if the buffer is not full yet). */
function snapshotRing(count: number): Float32Array {
  const n = Math.min(count, ringFilled);
  const out = new Float32Array(n);
  const start = (ringPos - n + ring.length) % ring.length;
  for (let i = 0; i < n; i++) out[i] = ring[(start + i) % ring.length];
  return out;
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/** Best guess of the current video time: the largest recently-updated video, extrapolated. */
function currentVideoTime(now: number): { time: number | null; playing: boolean } {
  // Prefer a playing video, then the biggest one (ads and previews are small).
  const score = (s: TimedState) => (s.paused ? 0 : 1e9) + s.area;
  let best: TimedState | undefined;
  for (const s of videoStates.values()) {
    if (now - s.at > 5000) continue;
    if (!best || score(s) > score(best)) best = s;
  }
  if (!best) return { time: null, playing: false };
  const elapsed = best.paused ? 0 : ((now - best.at) / 1000) * best.playbackRate;
  return { time: Math.min(best.duration, best.currentTime + elapsed), playing: !best.paused };
}

async function captureMoment(momentId: string, seconds: number): Promise<void> {
  const now = performance.now();
  const { time, playing } = currentVideoTime(now);
  const sampleRate = ctx?.sampleRate ?? 48000;
  const samples = snapshotRing(Math.round(Math.min(seconds, RING_SECONDS) * sampleRate));
  const screenshot = (await chrome.runtime.sendMessage({ type: 'screenshot' } satisfies Msg).catch(() => null)) as string | null;

  await fetch(`${server.url}/api/ext/moments/${momentId}/audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav', ...authHeaders(server) },
    body: encodeWav(samples, sampleRate),
  });
  const meta: ExtMomentMeta = {
    videoTime: time,
    playing,
    bufferSeconds: samples.length / sampleRate,
    pageTitle: '',
    pageUrl: '',
    videoDiag: time === null ? describeVideos(now) : undefined,
    screenshot: screenshot ?? undefined,
  };
  await fetch(`${server.url}/api/ext/moments/${momentId}/meta`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(server) },
    body: JSON.stringify(meta),
  });
}

// Watch time: while a video plays in the recorded tab, tell the laptop every 5 s (the Insights show it per episode).
// Only counts while the tab is in front and has made a sound in the last 30 s (a muted or forgotten tab is not watching).
setInterval(() => {
  const now = performance.now();
  if (!recording || now - lastSound > 30_000) return;
  const watching = [...videoStates.values()].some((s) => now - s.at < 5000 && !s.paused && !s.hidden);
  if (watching) send({ type: 'playing' });
}, 5000);

function send(msg: object): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function connect(): void {
  clearTimeout(reconnectTimer);
  if (!recording) return;
  ws = new WebSocket(wsUrl(server));
  ws.onopen = () => send({ type: 'hello', recording });
  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data)) as ServerToExt;
    if (msg.type === 'mark') captureMoment(msg.momentId, msg.seconds).catch((err) => console.error('Horu capture failed', err));
  };
  ws.onclose = () => {
    if (recording) reconnectTimer = window.setTimeout(connect, 3000);
  };
}

chrome.runtime.onMessage.addListener((msg: Msg, sender) => {
  if (msg.type === 'video-state') {
    const frameKey = `${sender.tab?.id}:${sender.frameId}`;
    videoStates.set(frameKey, { ...msg, at: performance.now(), frameKey });
  } else if (msg.type === 'video-diag') {
    videoDiags.set(`${sender.tab?.id}:${sender.frameId}`, { ...msg, at: performance.now() });
  } else if (msg.type === 'start-capture') {
    server = msg.server;
    startCapture(msg.streamId).catch((err) => {
      console.error('Horu: capture failed', err);
      chrome.runtime.sendMessage({ type: 'capture-stopped' } satisfies Msg).catch(() => {});
    });
  } else if (msg.type === 'stop-capture') {
    stopCapture();
  }
  return false;
});

// Diagnostics for the end-to-end tests (read via DevTools: horuDebug()).
(globalThis as unknown as { horuDebug: () => unknown }).horuDebug = () => {
  let peak = 0;
  for (let i = 0; i < ring.length; i++) peak = Math.max(peak, Math.abs(ring[i]));
  const track = stream?.getAudioTracks()[0];
  return { ctx: ctx?.state, sampleRate: ctx?.sampleRate, ringFilled, peak, track: track && { muted: track.muted, enabled: track.enabled, readyState: track.readyState }, ws: ws?.readyState, videos: videoStates.size };
};
