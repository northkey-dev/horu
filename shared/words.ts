// Word status (like Sluka / LingQ): how well the user knows a word, set by hand or from a known-word source.
// Words with no status are "new". Known and ignored words count as understood (comprehension %, previews).

export type WordStatus = -1 | 0 | 1 | 2 | 3 | 4;

export const STATUSES: { value: WordStatus; label: string }[] = [
  { value: 0, label: 'New' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: 'Known' },
  { value: -1, label: 'Ignore' },
];

export const isUnderstood = (s: WordStatus | undefined) => s === 4 || s === -1;

/** Everything the phone needs to judge words without the laptop. */
export type WordState = {
  /** Words known from Anki, jpdb, WaniKani, word lists and the JLPT baseline */
  known: string[];
  /** Status the user set by hand; overrides `known` */
  status: Record<string, WordStatus>;
  at: string;
};

const JP = /[぀-ヿ㐀-鿿々〆ー]/;

/** Words from a pasted list or file: one per line (first column of CSV/TSV), Japanese only. */
export function parseWordList(text: string): string[] {
  const words = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const first = line.split(/[\t,;]/)[0]?.trim().replace(/^"|"$/g, '');
    if (first && JP.test(first) && first.length <= 20) words.add(first);
  }
  return [...words];
}
