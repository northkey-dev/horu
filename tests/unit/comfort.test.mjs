import test from 'node:test';
import assert from 'node:assert/strict';
import { splitSentences } from '../../shared/sentences.ts';
import { matchesQuery } from '../../shared/search.ts';
import { autostartCheck, backupCheck, diskCheck } from '../../server/src/doctor.ts';

test('shared text is split into Japanese sentences', () => {
  assert.deepEqual(splitSentences('今日は雨だ。でも行く！\nHello world\nまた明日'), ['今日は雨だ。', 'でも行く！', 'また明日']);
  assert.deepEqual(splitSentences('「行こう。」と言った。'), ['「行こう。」', 'と言った。']);
  assert.deepEqual(splitSentences('only english'), []);
  assert.equal(splitSentences('あ。'.repeat(100)).length, 30);
});

const moment = { candidates: [{ text: '猫が好きです' }, { text: '犬も好き' }], sourceLabel: 'Frieren · Ep 5', title: 'Frieren', cardTarget: '好き' };
test('search: every word must appear, any line counts, case ignored', () => {
  assert.equal(matchesQuery(moment, ''), true);
  assert.equal(matchesQuery(moment, '犬 frieren'), true);
  assert.equal(matchesQuery(moment, '犬 naruto'), false);
  assert.equal(matchesQuery(moment, '好き'), true);
});

test('doctor: disk, backup and autostart verdicts', () => {
  assert.equal(diskCheck(0.5 * 1024 ** 3).state, 'bad');
  assert.equal(diskCheck(3 * 1024 ** 3).state, 'warn');
  assert.equal(diskCheck(50 * 1024 ** 3).state, 'ok');
  assert.equal(diskCheck(undefined).state, 'warn');
  assert.equal(backupCheck([], '2026-11-05').state, 'bad');
  assert.equal(backupCheck(['2026-11-05', '2026-11-04'], '2026-11-05').state, 'ok');
  assert.equal(backupCheck(['2026-11-01'], '2026-11-05').state, 'warn');
  assert.equal(autostartCheck('linux', undefined, false), undefined);
  assert.equal(autostartCheck('win32', undefined, true), undefined);
  assert.equal(autostartCheck('win32', undefined, false).state, 'warn');
  assert.equal(autostartCheck('win32', 'x', false).state, 'ok');
});

import { keepDays } from '../../server/src/retention.ts';
const day = (n) => new Date(Date.UTC(2026, 10, 5) - n * 86_400_000).toISOString().slice(0, 10);

test('backup retention: a week of days, then one per week, nothing else', () => {
  const days = Array.from({ length: 60 }, (_, i) => day(i)); // 2026-11-05 back to September
  const keep = keepDays(days);
  assert.deepEqual([...keep].sort().reverse().slice(0, 7), days.slice(0, 7));
  assert.equal(keep.length, 11);
  const older = keep.filter((d) => !days.slice(0, 7).includes(d));
  assert.equal(older.length, 4);
  // one per week, the newest of its week (Sundays count back from the first day after the daily window)
  assert.equal(new Set(older.map((d) => new Date(`${d}T12:00:00Z`).getTime() - ((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7) * 86_400_000)).size, 4);
});

test('backup retention: few days stay, gaps do not make it keep more', () => {
  assert.deepEqual(keepDays(['2026-11-05', '2026-11-04']).sort(), ['2026-11-04', '2026-11-05']);
  const sparse = ['2026-10-23', '2026-10-24', '2026-10-25', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];
  // 8 folders over two weeks: the newest 7 stay, the 8th shares a week with kept ones and goes
  assert.deepEqual(keepDays(sparse).sort(), sparse.slice(1));
});
