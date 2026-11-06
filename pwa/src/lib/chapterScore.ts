import type { ChapterData } from './manga.ts';
import { tokenize } from './japanese.ts';
import { statusOf } from './words.ts';
import { isWord } from '../components/TokenText.tsx';
import { isUnderstood } from '../../../shared/words.ts';
import { coverageOf, learnedBetween } from '../../../shared/chapterScore.ts';

// The chapter-end screen: how much of the chapter you understood, set against how much you did when you opened it,
// and the same number for the chapters of this manga you read before. All on the phone.

export type Snapshot = { words: string[]; understood: Set<string> };

async function understoodAmong(words: string[]): Promise<Set<string>> {
  const status = await statusOf([...new Set(words)]);
  return new Set(Object.keys(status).filter((w) => isUnderstood(status[w])));
}

/** Every word of the chapter in reading order (bubble corrections applied), with which of them are understood now. */
export async function snapshotOf(data: ChapterData, chapterKey: string, edits: Record<string, string>): Promise<Snapshot> {
  const words: string[] = [];
  for (let p = 0; p < data.pages.length; p++) {
    for (let b = 0; b < data.pages[p].blocks.length; b++) {
      const text = edits[`${chapterKey}/${p}/${b}`] ?? data.pages[p].blocks[b].text;
      for (const t of (await tokenize(text).catch(() => [])).filter(isWord)) words.push(t.base);
    }
  }
  return { words, understood: await understoodAmong(words) };
}

export type Result = { pct: number; before: number; learned: number };

/** The result now, against the snapshot taken when the chapter was opened. */
export async function resultSince(start: Snapshot): Promise<Result> {
  const now = await understoodAmong(start.words);
  return {
    pct: Math.round(100 * coverageOf(start.words, now)),
    before: Math.round(100 * coverageOf(start.words, start.understood)),
    learned: learnedBetween(start.words, start.understood, now),
  };
}

const KEY = 'horu-chapter-scores';
type Scores = Record<string, Record<string, number>>;

function read(): Scores {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Scores;
  } catch {
    return {};
  }
}

/** Remembers the result of a chapter (reading it again replaces it) and returns this manga's chapters in order. */
export function recordScore(mangaKey: string, order: number, pct: number): { order: number; pct: number }[] {
  const all = read();
  all[mangaKey] = { ...all[mangaKey], [order]: pct };
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // storage full or blocked: the screen still shows this chapter
  }
  return Object.entries(all[mangaKey])
    .map(([o, p]) => ({ order: Number(o), pct: p }))
    .sort((a, b) => a.order - b.order);
}
