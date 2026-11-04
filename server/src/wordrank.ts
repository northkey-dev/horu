// Which words and sentences are worth showing in the previews; pure, so it can be tested (tests/unit).

/** Interjections, laughter and sounds ("あっ", "はっ", "うーん") are frequent but not worth a card. */
export function isFiller(w: { word: string; pos?: string }): boolean {
  return w.pos === '感動詞' || /^[぀-ゟ゠-ヿー]{1,2}$/.test(w.word) || /[っッ]$/.test(w.word);
}

/** Short lines that contain the word as written make the best card sentences; fragments and long speeches the worst. */
export function exampleScore(line: string, base: string, surface: string): number {
  const len = line.replace(/\s/g, '').length;
  return (line.includes(base) ? 5 : line.includes(surface) ? 3 : 0) - (len < 6 ? 10 : len > 40 ? (len - 40) / 2 : 0) - Math.abs(len - 16) / 4;
}
