// Room audio for marks made without the laptop. While the Watch screen is open and the switch is on, the phone
// keeps the last seconds of microphone sound in memory and overwrites it continuously. Only a mark saves a copy.

const RATE_OUT = 16_000; // enough for speech and Whisper, a quarter of the data

let ctx: AudioContext | undefined;
let stream: MediaStream | undefined;
let node: ScriptProcessorNode | undefined;
let ring = new Float32Array(0);
let pos = 0;
let filled = false;

export const micActive = () => Boolean(stream);

/** Must be called from a tap (iOS only starts audio then). */
export async function startMic(seconds: number): Promise<void> {
  if (stream) return;
  stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
  ctx = new AudioContext();
  await ctx.resume();
  ring = new Float32Array(Math.ceil(ctx.sampleRate * seconds));
  pos = 0;
  filled = false;
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessor is old but needs no separate worklet file and runs everywhere, including iOS Safari.
  node = ctx.createScriptProcessor(4096, 1, 1);
  node.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    for (let i = 0; i < input.length; i++) {
      ring[pos++] = input[i];
      if (pos === ring.length) {
        pos = 0;
        filled = true;
      }
    }
  };
  source.connect(node);
  node.connect(ctx.destination); // outputs silence; without a destination the node does not run
}

export function stopMic(): void {
  node?.disconnect();
  stream?.getTracks().forEach((t) => t.stop());
  void ctx?.close();
  node = undefined;
  stream = undefined;
  ctx = undefined;
  ring = new Float32Array(0);
}

/** The buffered seconds as a 16 kHz mono WAV, oldest sound first; undefined when the microphone is off. */
export function micClip(): { wav: Blob; seconds: number } | undefined {
  if (!ctx || (!filled && pos === 0)) return undefined;
  const ordered = filled ? concat(ring.subarray(pos), ring.subarray(0, pos)) : ring.slice(0, pos);
  const samples = downsample(ordered, ctx.sampleRate, RATE_OUT);
  return { wav: toWav(samples, RATE_OUT), seconds: samples.length / RATE_OUT };
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** Averages each group of input samples into one output sample (cheap low-pass against aliasing). */
export function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (from <= to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

export function toWav(samples: Float32Array, rate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
