import { run } from './proc.ts';

const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';

/** Full buffer as MP3 for listening in the inbox (AnkiMobile and Safari both play MP3). */
export async function wavToMp3(wav: string, mp3: string): Promise<void> {
  await run(FFMPEG, ['-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-codec:a', 'libmp3lame', '-q:a', '4', mp3]);
}

/** Cuts [start, end] (seconds relative to the buffer start) out of the buffer. */
export async function cutClip(wav: string, start: number, end: number, mp3: string): Promise<void> {
  const from = Math.max(0, start);
  const duration = Math.max(0.3, end - from);
  await run(FFMPEG, [
    '-y',
    '-loglevel',
    'error',
    '-ss',
    from.toFixed(3),
    '-t',
    duration.toFixed(3),
    '-i',
    wav,
    '-ac',
    '1',
    '-af',
    'afade=t=in:d=0.05,areverse,afade=t=in:d=0.08,areverse',
    '-codec:a',
    'libmp3lame',
    '-q:a',
    '3',
    mp3,
  ]);
}

/** 16 kHz mono WAV for whisper. */
export async function toWhisperWav(input: string, output: string): Promise<void> {
  await run(FFMPEG, ['-y', '-loglevel', 'error', '-i', input, '-ac', '1', '-ar', '16000', output]);
}

export async function ffmpegAvailable(): Promise<boolean> {
  try {
    await run(FFMPEG, ['-version'], { timeoutMs: 5000 });
    return true;
  } catch {
    return false;
  }
}
