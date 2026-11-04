// Japanese or Chinese? Some manga sources list Chinese scans as Japanese. Japanese text has about three
// kana per kanji, Chinese has none; manga-ocr invents a few kana on Chinese pages, so the cut is generous.

const HAN = /[㐀-鿿]/g;
const KANA = /[ぁ-ゖァ-ヺ]/g;

/** True when the text is clearly Chinese; undefined when there is too little of it to tell. */
export function looksChinese(texts: string[]): boolean | undefined {
  const all = texts.join('');
  const han = all.match(HAN)?.length ?? 0;
  if (han < 40) return undefined;
  return (all.match(KANA)?.length ?? 0) < han * 0.5;
}

/**
 * True when a line of text is Japanese (kana or kanji) and not German, English or other Latin text.
 * Used to leave such lines out of what is read from photos: they are not what Horu is for. Full-width
 * Latin letters (what the text recognition makes of a Latin word) count as Latin.
 */
export function looksJapanese(text: string): boolean {
  const t = text.normalize('NFKC');
  const japanese = (t.match(/[ぁ-ゖァ-ヺ㐀-鿿]/g) ?? []).length;
  const latin = (t.match(/[A-Za-zÀ-ɏ]/g) ?? []).length;
  return japanese > 0 && japanese >= latin;
}
