// Splits shared text into the sentences worth mining: what an iOS Shortcut sends from the Share sheet.

const JAPANESE = /[぀-ヿ㐀-鿿]/;

/** Sentences of a text, split after 。！？ and at line breaks; only those with Japanese, at most `max`, each cut at 400 characters. */
export function splitSentences(text: string, max = 30): string[] {
  const parts = text
    .replace(/\r/g, '')
    .split(/\n+/)
    .flatMap((line) => line.match(/[^。！？!?]+[。！？!?]*[」』）)]*/g) ?? []);
  return parts
    .map((p) => p.trim().slice(0, 400))
    .filter((p) => p && JAPANESE.test(p))
    .slice(0, max);
}
