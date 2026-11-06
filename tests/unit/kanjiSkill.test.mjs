import test from 'node:test';
import assert from 'node:assert/strict';
import { afterRound, kunShown, levelOf, mergeSkill, pickKanji, questionsFor, readingOf } from '../../shared/kanjiSkill.ts';

test('a stamp comes from the quiz only, never from having seen the kanji', () => {
  assert.equal(levelOf(undefined), 0);
  assert.equal(levelOf({ box: 0, at: 'd', right: 0, wrong: 1 }), 0);
  assert.equal(levelOf({ box: 1, at: 'd', right: 1, wrong: 0 }), 1);
  assert.equal(levelOf({ box: 2, at: 'd', right: 2, wrong: 0 }), 1);
  assert.equal(levelOf({ box: 3, at: 'd', right: 3, wrong: 0 }), 2);
});

test('rounds: one box a day, gold takes three days, a miss sets back one box', () => {
  let s = afterRound(undefined, true, '2026-11-06');
  assert.equal(s.box, 1);
  s = afterRound(s, true, '2026-11-06');
  assert.equal(s.box, 1, 'the same day does not climb again');
  s = afterRound(s, true, '2026-11-07');
  assert.equal(s.box, 2);
  s = afterRound(s, true, '2026-11-08');
  assert.equal(levelOf(s), 2);
  s = afterRound(s, false, '2026-11-09');
  assert.equal(s.box, 2);
  assert.equal(s.wrong, 1);
  assert.equal(afterRound(undefined, false, 'd').box, 0);
});

test('two copies merge per kanji, the later round wins', () => {
  const a = { 日: { box: 1, at: '2026-11-05', right: 1, wrong: 0 }, 月: { box: 2, at: '2026-11-06', right: 2, wrong: 0 } };
  const b = { 日: { box: 2, at: '2026-11-06', right: 2, wrong: 0 }, 月: { box: 1, at: '2026-11-05', right: 1, wrong: 0 }, 火: { box: 1, at: '2026-11-04', right: 1, wrong: 0 } };
  const m = mergeSkill(a, b);
  assert.equal(m['日'].box, 2);
  assert.equal(m['月'].box, 2);
  assert.equal(m['火'].box, 1);
});

test('quiz pick: kanji without a stamp first, then due ones by box, nothing done today', () => {
  const skill = {
    二: { box: 1, at: '2026-11-05', right: 1, wrong: 0 },
    三: { box: 2, at: '2026-11-05', right: 2, wrong: 0 },
    四: { box: 1, at: '2026-11-06', right: 1, wrong: 0 },
    五: { box: 3, at: '2026-11-05', right: 3, wrong: 0 },
  };
  assert.deepEqual(pickKanji(['三', '一', '二', '四', '五', '六'], skill, '2026-11-06', 10), ['一', '六', '二', '三']);
  assert.equal(pickKanji(['一', '六'], skill, '2026-11-06', 1).length, 1);
});

const dic = Object.fromEntries(
  [
    ['日', ['day', 'sun'], ['ニチ'], ['ひ']],
    ['月', ['month', 'moon'], ['ゲツ'], ['つき']],
    ['火', ['fire'], ['カ'], ['ひ']],
    ['水', ['water'], ['スイ'], ['みず']],
    ['木', ['tree'], ['モク'], ['き']],
  ].map(([k, meanings, on, kun]) => [k, { meanings, on, kun }]),
);

test('questions: meaning and reading, four distinct options with the answer among them', () => {
  const qs = questionsFor('日', dic, Object.keys(dic), () => 0.3);
  assert.equal(qs.length, 2);
  assert.equal(qs[0].kind, 'meaning');
  assert.equal(qs[0].answer, 'day, sun');
  assert.equal(qs[1].answer, 'ニチ · ひ');
  for (const q of qs) {
    assert.equal(q.options.length, 4);
    assert.equal(new Set(q.options).size, 4);
    assert.ok(q.options.includes(q.answer));
  }
  assert.equal(readingOf({ meanings: ['x'], on: [], kun: ['-び'] }), 'び');
});

test('questions: a pool too small to make distinct options asks nothing', () => {
  assert.equal(questionsFor('日', dic, ['日', '月'], () => 0.3), null);
  assert.equal(questionsFor('？', dic, Object.keys(dic)), null);
});

import { gradeGroups } from '../../shared/kanjiSkill.ts';
test('grade groups: only jouyou kanji, by grade, the easier JLPT ones first', () => {
  const d = {
    一: { meanings: ['one'], on: [], kun: [], grade: 1, jlpt: 4 },
    左: { meanings: ['left'], on: [], kun: [], grade: 1, jlpt: null },
    九: { meanings: ['nine'], on: [], kun: [], grade: 1, jlpt: 4 },
    薔: { meanings: ['rose'], on: [], kun: [], grade: 10, jlpt: null },
    憂: { meanings: ['grief'], on: [], kun: [], grade: 8, jlpt: null },
  };
  const g = gradeGroups(d);
  assert.deepEqual(g.find((x) => x.grade === 1).kanji, ['一', '九', '左']);
  assert.deepEqual(g.find((x) => x.grade === 8).kanji, ['憂']);
  assert.ok(!g.some((x) => x.kanji.includes('薔')));
});

test('kun yomi are shown with the okurigana in brackets', () => {
  assert.equal(kunShown('ひ.く'), 'ひ(く)');
  assert.equal(kunShown('-び'), '-び');
  assert.equal(kunShown('はい.る'), 'はい(る)');
});
