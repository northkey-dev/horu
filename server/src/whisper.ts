import fs from 'node:fs';
import { getSettings } from './config.ts';
import { toWhisperWav } from './audio.ts';
import { PyWorker } from './pyworker.ts';

// Japanese speech-to-text fallback (faster-whisper on CPU, tools/whisper_worker.py).

type Segment = { start: number; end: number; text: string };

const worker = new PyWorker('whisper', 'whisper_worker.py', () => [getSettings().whisperModel]);

export function whisperAvailable(): boolean {
  return worker.available();
}

/** Transcribes an audio file; returns segments with times relative to the file start. */
export async function transcribe(audioFile: string): Promise<Segment[]> {
  const wav16 = audioFile.replace(/\.\w+$/, '.16k.wav');
  await toWhisperWav(audioFile, wav16);
  try {
    const res = await worker.request<{ segments: Segment[] }>({ file: wav16 });
    return res.segments;
  } finally {
    fs.rmSync(wav16, { force: true });
  }
}
