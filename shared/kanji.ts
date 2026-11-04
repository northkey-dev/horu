// KANJIDIC entries, used when JMdict has no word: a meaning per character and a guessed reading for furigana.

export type KanjiInfo = { meanings: string[]; on: string[]; kun: string[]; jlpt?: number | null; grade?: number | null };

export const KANJI_CHAR = /[㐀-鿿豈-﫿]/;

export const kanjiOf = (text: string): string[] => [...new Set([...text].filter((c) => KANJI_CHAR.test(c)))];

const hiragana = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/**
 * Reading of a word the tokenizer does not know, character by character: the first on'yomi (compounds
 * mostly use those), else the stem of the first kun'yomi. Undefined when a kanji has neither.
 */
export function guessReading(surface: string, dic: Record<string, KanjiInfo>): string | undefined {
  let out = '';
  for (const c of surface) {
    if (!KANJI_CHAR.test(c)) {
      out += hiragana(c);
      continue;
    }
    const info = dic[c];
    const reading = info?.on[0] ?? info?.kun[0]?.split('.')[0];
    if (!reading) return undefined;
    out += hiragana(reading.replace(/-/g, ''));
  }
  return out;
}
