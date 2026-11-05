import { kanjiOf } from './kanji.ts';

// What to practise, taken from the sentences the user marked: the words they do not know yet and the kanji
// those words are made of. Pure, so it runs on the phone and in tests alike.

export type PracticeWord = { surface: string; base: string; content: boolean };
export type PracticeSentence = { text: string; words: PracticeWord[] };
export type WordCard = { word: string; sentence: string; count: number };
export type KanjiRow = { kanji: string; count: number; word: string; sentence: string };

/**
 * Unknown content words with a kanji in them, the most often seen first (ties: the newest sentence first;
 * `sentences` are newest first). Words that are known or that `skip` names are left out.
 */
export function wordsToPractice(sentences: PracticeSentence[], isKnown: (word: string) => boolean, skip: (word: string) => boolean = () => false, limit = 60): WordCard[] {
  const found = new Map<string, WordCard>();
  for (const s of sentences) {
    for (const w of s.words) {
      if (!w.content || !kanjiOf(w.base).length || isKnown(w.base) || skip(w.base)) continue;
      const card = found.get(w.base);
      if (card) card.count++;
      else found.set(w.base, { word: w.base, sentence: s.text, count: 1 });
    }
  }
  return [...found.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

/**
 * Kanji in the marked sentences that no known word contains, the most frequent first. A kanji counts as known
 * as soon as one word with it is known: seeing it again in a new word is then a new word, not a new kanji.
 */
export function kanjiFocus(sentences: PracticeSentence[], isKnown: (word: string) => boolean, limit = 15): KanjiRow[] {
  const knownKanji = new Set<string>();
  for (const s of sentences) for (const w of s.words) if (isKnown(w.base) || isKnown(w.surface)) kanjiOf(w.base + w.surface).forEach((k) => knownKanji.add(k));
  const rows = new Map<string, KanjiRow>();
  for (const s of sentences) {
    for (const w of s.words) {
      for (const k of kanjiOf(w.surface)) {
        if (knownKanji.has(k)) continue;
        const row = rows.get(k);
        if (row) row.count++;
        else rows.set(k, { kanji: k, count: 1, word: w.base || w.surface, sentence: s.text });
      }
    }
  }
  return [...rows.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}
