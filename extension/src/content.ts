import type { Msg, PageText, VideoDiag, VideoState } from './messages.ts';
import { textFromPath } from '../../shared/detect.ts';

// Runs in every frame (players are often embedded from other domains). While the
// tab is being recorded, reports the main video's playback position once per second.

let timer: number | undefined;

/** All <video> elements of this frame, including those inside open shadow roots (custom players). */
function allVideos(root: ParentNode = document, shadow = false): { el: HTMLVideoElement; shadow: boolean }[] {
  const found = Array.from(root.querySelectorAll('video')).map((el) => ({ el, shadow }));
  for (const host of Array.from(root.querySelectorAll('*'))) {
    if (host.shadowRoot) found.push(...allVideos(host.shadowRoot, true));
  }
  return found;
}

function mainVideo(): HTMLVideoElement | undefined {
  let best: HTMLVideoElement | undefined;
  let bestArea = 0;
  for (const v of allVideos().map((x) => x.el)) {
    if (!(v.duration > 30) || v.readyState === 0) continue;
    const r = v.getBoundingClientRect();
    const area = r.width * r.height;
    if (area > bestArea) {
      best = v;
      bestArea = area;
    }
  }
  return best;
}

let lastDiag = 0;
function reportDiag(): void {
  const videos = allVideos().map(({ el, shadow }) => {
    const r = el.getBoundingClientRect();
    const src = el.currentSrc || el.src;
    return {
      duration: Number.isFinite(el.duration) ? Math.round(el.duration) : null,
      readyState: el.readyState,
      width: Math.round(r.width),
      height: Math.round(r.height),
      paused: el.paused,
      source: (src.startsWith('blob:') ? 'blob' : src ? 'http' : 'none') as 'blob' | 'http' | 'none',
      shadow,
    };
  });
  const top = window === window.top;
  if (!videos.length && !top) return; // empty ad/tracker frames are not interesting
  chrome.runtime.sendMessage({ type: 'video-diag', top, videos } satisfies VideoDiag).catch(() => {});
}

function report(): void {
  if (Date.now() - lastDiag > 2000) {
    lastDiag = Date.now();
    reportDiag();
  }
  const v = mainVideo();
  if (!v) return;
  const r = v.getBoundingClientRect();
  const msg: VideoState = {
    type: 'video-state',
    currentTime: v.currentTime,
    paused: v.paused,
    playbackRate: v.playbackRate,
    duration: v.duration,
    area: r.width * r.height,
    hidden: document.hidden,
  };
  chrome.runtime.sendMessage(msg).catch(() => {});
}

// ---- the page's own Japanese subtitles ----
// While recording, subtitles the page shows itself become the episode's lines, timed by the video: a player's
// text track as a whole, or lines read off the screen as they appear (YouTube, Netflix, Prime Video, common
// web players). Subtitle files the page downloads are picked up by the service worker.

const KANA = /[぀-ヿ]/;
const CAPTION_SELECTORS = [
  '.ytp-caption-segment',
  '.player-timedtext-text-container',
  '.atvwebplayersdk-captions-text',
  '.vjs-text-track-cue',
  '.jw-text-track-cue',
  '.shaka-text-container span',
  '.plyr__caption',
  '.dplayer-subtitle',
  '.art-subtitle',
];
type Line = { start: number; end: number; text: string };
const sentTracks = new WeakMap<TextTrack, number>();
let subsTimer: number | undefined;
let shown: { text: string; start: number } | undefined;
let pending: Line[] = [];
let flushedAt = 0;

const sendSubs = (cues: Line[], live: boolean) => chrome.runtime.sendMessage({ type: 'site-subs', cues, live } satisfies Msg).catch(() => {});

function japaneseTrack(v: HTMLVideoElement): TextTrack | undefined {
  const tracks = Array.from(v.textTracks).filter((t) => t.kind === 'subtitles' || t.kind === 'captions');
  return (
    tracks.find((t) => /^ja/i.test(t.language) || /japan|日本/i.test(t.label)) ??
    tracks.find((t) => t.mode !== 'disabled' && Array.from(t.cues ?? []).some((c) => KANA.test((c as VTTCue).text ?? '')))
  );
}

function readTrack(v: HTMLVideoElement): void {
  const track = japaneseTrack(v);
  if (!track) return;
  if (track.mode === 'disabled') track.mode = 'hidden'; // loads the cues without showing them
  const cues = Array.from(track.cues ?? []);
  if (!cues.length || sentTracks.get(track) === cues.length) return;
  sentTracks.set(track, cues.length);
  const lines = cues
    .map((c) => ({ start: c.startTime, end: c.endTime, text: ((c as VTTCue).text ?? '').replace(/<[^>]+>/g, '').trim() }))
    .filter((c) => c.text);
  if (lines.length) void sendSubs(lines, false);
}

function screenText(): string {
  for (const selector of CAPTION_SELECTORS) {
    const parts = Array.from(document.querySelectorAll<HTMLElement>(selector))
      .map((e) => e.innerText.trim())
      .filter(Boolean);
    if (parts.length) return [...new Set(parts)].join(selector === '.ytp-caption-segment' ? '' : '\n');
  }
  return '';
}

function readScreen(): void {
  const v = mainVideo();
  if (!v) return;
  readTrack(v);
  const t = v.currentTime;
  const text = screenText();
  if (shown && (shown.text !== text || t < shown.start)) {
    if (t > shown.start) pending.push({ start: shown.start, end: t, text: shown.text });
    shown = undefined;
  }
  if (!shown && text && KANA.test(text) && text.length < 200) shown = { text, start: t };
  // Every two seconds, including the line on screen right now (so a mark finds it at once).
  if (Date.now() - flushedAt > 2000 && (pending.length || shown)) {
    flushedAt = Date.now();
    void sendSubs([...pending, ...(shown ? [{ start: shown.start, end: t, text: shown.text }] : [])], true);
    pending = [];
  }
}

function setReporting(enabled: boolean): void {
  clearInterval(timer);
  clearInterval(subsTimer);
  timer = undefined;
  shown = undefined;
  pending = [];
  if (!enabled) return;
  timer = window.setInterval(report, 1000);
  subsTimer = window.setInterval(readScreen, 300);
  // Report immediately on play/pause/seek so the time is exact after jumps.
  for (const ev of ['play', 'pause', 'seeked', 'ratechange']) {
    document.addEventListener(ev, report, { capture: true });
  }
  report();
}

// ---- which show and episode is this page? ----
// Only the words that name it go to the laptop (never the host or the query string), and only while the tab is
// recorded. shared/detect.ts reads them; texts that agree outvote a site name.

const meta = (name: string) => document.querySelector<HTMLMetaElement>(`meta[property="${name}"], meta[name="${name}"]`)?.content?.trim();

function jsonLdTexts(): PageText[] {
  const out: PageText[] = [];
  for (const el of Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 6)) {
    try {
      const walk = (n: unknown): void => {
        if (Array.isArray(n)) return n.forEach(walk);
        if (!n || typeof n !== 'object') return;
        const o = n as Record<string, unknown>;
        const series = typeof (o.partOfSeries as { name?: unknown } | undefined)?.name === 'string' ? (o.partOfSeries as { name: string }).name : undefined;
        if (series && o.episodeNumber !== undefined) out.push({ text: `${series} Episode ${String(o.episodeNumber)}`, weight: 4 });
        else if (typeof o.name === 'string') out.push({ text: o.name, weight: 3 });
        Object.values(o).forEach(walk);
      };
      walk(JSON.parse(el.textContent ?? ''));
    } catch {
      // not JSON
    }
  }
  return out;
}

function pageTexts(): PageText[] {
  const texts: PageText[] = [];
  const add = (text: string | undefined | null, weight: number) => {
    const t = text?.replace(/s+/g, ' ').trim().slice(0, 200);
    if (t) texts.push({ text: t, weight });
  };
  const session = navigator.mediaSession?.metadata;
  add(session?.title, 3);
  add(session?.album, 2);
  add(session?.artist, 1);
  add(meta('og:title'), 2);
  add(document.title, 2);
  add(meta('twitter:title'), 1);
  add(document.querySelector('h1')?.textContent, 2);
  texts.push(...jsonLdTexts().slice(0, 6));
  const query = new URLSearchParams(location.search);
  const ep = ['ep', 'episode', 'e'].map((k) => query.get(k)).find((v) => v && /^d{1,4}$/.test(v));
  add([textFromPath(location.pathname), ep ? `episode ${ep}` : ''].filter(Boolean).join(' '), 1);
  return texts;
}

chrome.runtime.onMessage.addListener((msg: Msg, _sender, sendResponse) => {
  if (msg.type === 'reporting') setReporting(msg.enabled);
  if (msg.type === 'page-texts') {
    sendResponse(window === window.top ? pageTexts() : undefined);
    return false;
  }
  return false;
});

chrome.runtime
  .sendMessage({ type: 'should-report' } satisfies Msg)
  .then((enabled: boolean) => setReporting(Boolean(enabled)))
  .catch(() => {});
