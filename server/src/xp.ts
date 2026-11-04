import type { DayStat } from '../../shared/types.ts';

// The scoring rules of the progress page, kept free of I/O so they can be tested (tests/unit).

// Watching pays per full 5 minutes of playback, counted across episodes and days: the part of a block that is
// left over (a 19-minute episode leaves 4 minutes) carries on into the next episode.
export const XP = { review: 1, mark: 3, card: 10, watchBlock: 5, chapter: 15, readBlock: 5 };
export const WATCH_BLOCK_SECONDS = 300;
/** Reading pays per full 250 words (about five minutes for a learner), per day. */
export const READ_BLOCK_WORDS = 250;

/** Level n starts at 50·n·(n−1) XP: 100, 300, 600, 1000 … */
export function levelOf(xp: number): { n: number; xp: number; from: number; to: number } {
  const n = Math.floor((1 + Math.sqrt(1 + xp / 12.5)) / 2);
  return { n, xp, from: 50 * n * (n - 1), to: 50 * (n + 1) * n };
}

/** Paid 5-minute blocks per day from the seconds watched per day, oldest first, the remainder carried forward. */
export function watchBlocksByDay(secondsByDay: ReadonlyMap<string, number>): Map<string, number> {
  const blocks = new Map<string, number>();
  let carry = 0;
  for (const day of [...secondsByDay.keys()].sort()) {
    const total = carry + secondsByDay.get(day)!;
    const n = Math.floor(total / WATCH_BLOCK_SECONDS);
    carry = total - n * WATCH_BLOCK_SECONDS;
    blocks.set(day, n);
  }
  return blocks;
}

export const isActive = (d: DayStat): boolean => d.reviews + d.marked + d.cards + d.watchBlocks + d.chapters > 0;

/**
 * Current and best streak over consecutive days (oldest first, the last one is today). Anki reviews from the
 * phone arrive late (AnkiWeb → laptop), so a quiet day that the last Anki read (`seenUntil`, a day key) could
 * not have seen completely is "pending": it neither counts nor breaks the streak and is settled by the next read.
 */
export function streaks(days: DayStat[], seenUntil?: string): { current: number; best: number; activeToday: boolean } {
  const today = days[days.length - 1];
  const pending = (d: DayStat) => seenUntil !== undefined && !isActive(d) && d.day >= seenUntil && d.day < today.day;
  let current = 0;
  for (let i = days.length - (isActive(today) ? 1 : 2); i >= 0; i--) {
    if (isActive(days[i])) current++;
    else if (!pending(days[i])) break;
  }
  let best = 0;
  let run = 0;
  for (const d of days) {
    if (isActive(d)) best = Math.max(best, ++run);
    else if (!pending(d)) run = 0;
  }
  return { current, best, activeToday: isActive(today) };
}
