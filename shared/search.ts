import type { Moment } from './types.ts';

// Search in Inbox and History: every word you type has to appear somewhere in the moment (any of its lines, the
// word of the card, where it is from).

const haystack = (m: Moment): string =>
  [...m.candidates.map((c) => c.text), m.cardSentence, m.cardTarget, m.targetHint, m.sourceLabel, m.title, m.mangaTitle, m.chapterName].filter(Boolean).join('\n').toLowerCase();

export function matchesQuery(m: Moment, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const text = haystack(m);
  return terms.every((t) => text.includes(t));
}
