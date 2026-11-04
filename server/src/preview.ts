import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, writeJsonAtomic } from './config.ts';
import { addNote, ensureAnki, existingTargets } from './anki.ts';
import { furiganaHtml, readingOf } from './japanese.ts';
import { escapeHtml, highlight } from '../../shared/furigana.ts';
import * as store from './store.ts';

// Cards for words from the "Before you watch / read" lists: the example line, no audio, no Claude call.

export type PreviewCard = { word: string; reading?: string; meaning?: string; example?: string; source?: string };

const FILE = path.join(DATA_DIR, 'prepared.json');
type Prepared = { word: string; at: string; source: string };
const prepared: Prepared[] = (() => {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8')) as Prepared[];
  } catch {
    return [];
  }
})();

/** How many words were prepared with a card before watching or reading (shown in Insights). */
export const preparedCount = (): number => prepared.length;

async function addOne(c: PreviewCard): Promise<void> {
  const sentence = (c.example ?? '').replace(/\s+/g, ' ').trim() || c.word;
  // The word is in dictionary form; highlight it only where it appears literally (inflected forms stay plain).
  const start = sentence.indexOf(c.word);
  const [from, to] = start >= 0 ? [start, start + c.word.length] : [0, 0];
  await addNote({
    sentence: start >= 0 ? highlight(sentence, from, to) : escapeHtml(sentence),
    sentenceFurigana: await furiganaHtml(sentence, from, to),
    target: c.word,
    targetReading: c.reading && c.reading !== c.word ? c.reading : await readingOf(c.word),
    targetMeaning: c.meaning ?? '',
    translation: '',
    explanation: '',
    context: '',
    source: c.source ?? 'Before watching',
    mediaPrefix: `horu_preview_${store.newId()}`,
    tags: ['preview'],
  });
  prepared.push({ word: c.word, at: new Date().toISOString(), source: c.source ?? '' });
  writeJsonAtomic(FILE, prepared);
}

/** Adds a card per word unless a Horu note with that target already exists. */
export async function addPreviewCards(cards: PreviewCard[]): Promise<{ added: string[]; existing: string[] }> {
  const wanted = cards.filter((c) => c.word?.trim());
  if (!wanted.length) throw new Error('word missing');
  await ensureAnki();
  const have = await existingTargets(wanted.map((c) => c.word));
  const added: string[] = [];
  for (const c of wanted) {
    if (have.has(c.word)) continue;
    await addOne(c);
    added.push(c.word);
  }
  return { added, existing: wanted.filter((c) => have.has(c.word)).map((c) => c.word) };
}
