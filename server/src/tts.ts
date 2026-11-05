import fs from 'node:fs';
import path from 'node:path';
import { wavToMp3 } from './audio.ts';
import { TOOLS_DIR, getSettings } from './config.ts';
import { tokenizer } from './japanese.ts';
import { printedReading, type Printed } from '../../shared/readings.ts';
import { log } from './log.ts';
import { PyWorker } from './pyworker.ts';

// A computer voice for cards without sound (manga, text, photos): Kokoro-82M on this computer, no account and no
// costs (tools/tts_worker.py, installer module "tts").

const MODEL = path.join(TOOLS_DIR, 'tts', 'kokoro-v1.0.int8.onnx');
const VOICES = path.join(TOOLS_DIR, 'tts', 'voices-v1.0.bin');
const worker = new PyWorker('tts', 'tts_worker.py', () => [MODEL, VOICES], 2 * 60_000);
// The neural voice of Microsoft Edge (tools/edge_worker.py, needs internet): much more natural than Kokoro, used for the
// Listen buttons while it works. The text leaves this computer for Microsoft's speech service, so it can be switched off.
const edge = new PyWorker('edge', 'edge_worker.py', () => [], 5 * 60_000);
let edgeDownUntil = 0;

export const ttsInstalled = () => worker.available() && fs.existsSync(MODEL) && fs.existsSync(VOICES);
export const ttsOn = () => ttsInstalled() && getSettings().voiceCards;
/** The Listen buttons: independent of the voice on cards */
export const listenOn = () => ttsInstalled() || (getSettings().voiceOnline && edge.available());

/**
 * How a sentence sounds, in kana with a space between word groups. The voice gets this instead of the kanji: its own
 * reading is often wrong (何を as nan o, 金曜日 as kinyouhi), and this way it says what the furigana on the card say:
 * the reading printed on the page where there is one, else the corrected dictionary.
 */
export async function pronunciation(text: string, printed?: Printed[]): Promise<string> {
  const tokens = (await tokenizer()).tokenize(text.normalize('NFKC'));
  return tokens
    .map((t, i) => {
      const kana = printedReading(t.surface_form, printed) ?? (t.pronunciation && t.pronunciation !== '*' ? t.pronunciation : t.surface_form);
      const next = tokens[i + 1];
      const joined = !next || ['助詞', '助動詞', '記号'].includes(next.pos) || next.pos_detail_1 === '接尾' || t.pos === '接頭詞';
      return joined ? kana : `${kana} `;
    })
    .join('');
}

/**
 * Reads a Japanese text for the Listen buttons: with the Edge voice when allowed and reachable, else with Kokoro.
 * After a failure (no internet) Edge is left alone for a minute so the next tap does not wait for it again.
 */
export async function listen(text: string, mp3: string, printed?: Printed[]): Promise<void> {
  if (getSettings().voiceOnline && edge.available() && Date.now() > edgeDownUntil) {
    try {
      await edge.request({ text: text.slice(0, 400), file: mp3 });
      if (fs.existsSync(mp3) && fs.statSync(mp3).size > 0) return;
    } catch (err) {
      log.info('Edge voice not available:', (err as Error).message);
    }
    edgeDownUntil = Date.now() + 60_000;
  }
  if (!ttsInstalled()) throw new Error('No voice available.');
  await speak(text, mp3, printed);
}

/** Reads a Japanese sentence into an MP3. */
export async function speak(text: string, mp3: string, printed?: Printed[]): Promise<void> {
  const wav = `${mp3}.wav`;
  try {
    await worker.request({ text: await pronunciation(text.slice(0, 400), printed), file: wav });
    await wavToMp3(wav, mp3);
  } finally {
    fs.rmSync(wav, { force: true });
  }
}
