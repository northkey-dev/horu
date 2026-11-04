import test from 'node:test';
import assert from 'node:assert/strict';
import { levelOf, streaks, watchBlocksByDay } from '../../server/src/xp.ts';

const day = (key, active = false) => ({ day: key, reviews: active ? 5 : 0, minutes: 0, learned: 0, marked: 0, cards: 0, episodes: 0, chapters: 0, watched: 0, watchBlocks: 0, xp: 0 });
const run = (flags, start = 1) => flags.map((a, i) => day(`2026-10-${String(start + i).padStart(2, '0')}`, a));

test('watch blocks: a full block pays, the remainder carries into the next episode', () => {
  const blocks = watchBlocksByDay(new Map([['2026-10-01', 19 * 60]]));
  assert.equal(blocks.get('2026-10-01'), 3); // 15 of 19 minutes paid, 4 minutes left over
  const next = watchBlocksByDay(new Map([['2026-10-01', 19 * 60], ['2026-10-02', 60]]));
  assert.equal(next.get('2026-10-02'), 1); // 4 + 1 minutes
});

test('watch blocks: order of insertion does not matter, nothing is lost or invented', () => {
  const a = watchBlocksByDay(new Map([['2026-10-03', 200], ['2026-10-01', 200], ['2026-10-02', 200]]));
  assert.deepEqual([...a.values()], [0, 1, 1]); // 200, 400 → 1 (100 left), 300 → 1
  assert.equal([...a.values()].reduce((n, b) => n + b, 0), Math.floor(600 / 300));
});

test('watch blocks: less than five minutes pays nothing yet', () => {
  assert.equal(watchBlocksByDay(new Map([['2026-10-01', 299]])).get('2026-10-01'), 0);
});

test('level thresholds', () => {
  assert.deepEqual(levelOf(0), { n: 1, xp: 0, from: 0, to: 100 });
  assert.equal(levelOf(99).n, 1);
  assert.equal(levelOf(100).n, 2);
  assert.equal(levelOf(300).n, 3);
  assert.equal(levelOf(600).n, 4);
});

test('streak: counts back from today, an empty today does not break it yet', () => {
  assert.deepEqual(streaks(run([true, true, true])), { current: 3, best: 3, activeToday: true });
  assert.deepEqual(streaks(run([true, true, false])), { current: 2, best: 2, activeToday: false });
});

test('streak: a gap breaks it, best remembers the longest run', () => {
  const s = streaks(run([true, true, true, false, true, true]));
  assert.equal(s.current, 2);
  assert.equal(s.best, 3);
});

test('streak: a quiet day the last Anki read could not see yet bridges the gap', () => {
  const days = run([true, true, false, false, true]);
  assert.equal(streaks(days).current, 1); // without the bridge the streak is broken
  const bridged = streaks(days, '2026-10-03'); // read on the 3rd: days 3 and 4 may still be unsynced
  assert.equal(bridged.current, 3);
  assert.equal(bridged.best, 3);
});

test('streak: days before the last read are settled and still break it', () => {
  const s = streaks(run([true, false, true, true]), '2026-10-03');
  assert.equal(s.current, 2);
});
