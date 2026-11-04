import fs from 'node:fs';
import path from 'node:path';
import { wavToMp3 } from './audio.ts';
import { TOOLS_DIR, getSettings } from './config.ts';
import { tokenizer } from './japanese.ts';
import { PyWorker } from './pyworker.ts';

// A computer voice for cards without sound (manga, text, photos): Kokoro-82M on this computer, no account and no
// costs (tools/tts_worker.py, installer module "tts").

const MODEL = path.join(TOOLS_DIR, 'tts', 'kokoro-v1.0.int8.onnx');
const VOICES = path.join(TOOLS_DIR, 'tts', 'voices-v1.0.bin');
const worker = new PyWorker('tts', 'tts_worker.py', () => [MODEL, VOICES], 2 * 60_000);

export const ttsInstalled = () => worker.available() && fs.existsSync(MODEL) && fs.existsSync(VOICES);
export const ttsOn = () => ttsInstalled() && getSettings().voiceCards;

// Counters with readings of their own, which the tokenizer reads digit by digit (３日 as sannichi). 1日 stays out: it
// can be ついたち or いちにち.
const DAYS: Record<string, string> = { 2: 'ふつか', 3: 'みっか', 4: 'よっか', 5: 'いつか', 6: 'むいか', 7: 'なのか', 8: 'ようか', 9: 'ここのか', 10: 'とおか', 14: 'じゅうよっか', 20: 'はつか' };
const PEOPLE: Record<string, string> = { 1: 'ひとり', 2: 'ふたり' };
const THINGS: Record<string, string> = { 1: 'ひとつ', 2: 'ふたつ', 3: 'みっつ', 4: 'よっつ', 5: 'いつつ', 6: 'むっつ', 7: 'ななつ', 8: 'やっつ', 9: 'ここのつ' };

const counted = (text: string) =>
  text
    .replace(/(?<![\d.])(\d+)日/g, (all, n: string) => DAYS[n] ?? all)
    .replace(/(?<![\d.])(\d+)人/g, (all, n: string) => PEOPLE[n] ?? all)
    .replace(/(?<![\d.])(\d+)つ/g, (all, n: string) => THINGS[n] ?? all)
    .replace(/(?<![一二三四五六七八九十百千万])一人/g, 'ひとり')
    .replace(/(?<![一二三四五六七八九十百千万])二人/g, 'ふたり');

/**
 * How a sentence sounds, in kana with a space between word groups. The voice gets this instead of the kanji: its own
 * reading is often wrong (何を as nan o, 金曜日 as kinyouhi), and this way it says what the furigana on the card say.
 */
export async function pronunciation(text: string): Promise<string> {
  const tokens = (await tokenizer()).tokenize(counted(text.normalize('NFKC')));
  return tokens
    .map((t, i) => {
      const kana = t.pronunciation && t.pronunciation !== '*' ? t.pronunciation : t.surface_form;
      const next = tokens[i + 1];
      const joined = !next || ['助詞', '助動詞', '記号'].includes(next.pos) || next.pos_detail_1 === '接尾' || t.pos === '接頭詞';
      return joined ? kana : `${kana} `;
    })
    .join('');
}

/** Reads a Japanese sentence into an MP3. */
export async function speak(text: string, mp3: string): Promise<void> {
  const wav = `${mp3}.wav`;
  try {
    await worker.request({ text: await pronunciation(text.slice(0, 400)), file: wav });
    await wavToMp3(wav, mp3);
  } finally {
    fs.rmSync(wav, { force: true });
  }
}
