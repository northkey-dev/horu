import test from 'node:test';
import assert from 'node:assert/strict';
import { kanjiFocus, wordsToPractice } from '../../shared/practice.ts';

const w = (base, surface = base, content = true) => ({ base, surface, content });
const sentences = [
  { text: '新しい学校へ行く', words: [w('新しい'), w('学校'), w('へ', 'へ', false), w('行く')] },
  { text: '学校は遠い', words: [w('学校'), w('は', 'は', false), w('遠い')] },
  { text: 'ねこがいる', words: [w('ねこ'), w('いる')] },
];
const known = new Set(['行く']);

test('words to practise: unknown content words with a kanji, most seen first', () => {
  const cards = wordsToPractice(sentences, (x) => known.has(x));
  assert.deepEqual(cards.map((c) => [c.word, c.count]), [['学校', 2], ['新しい', 1], ['遠い', 1]]);
  assert.equal(cards[0].sentence, '新しい学校へ行く');
});

test('words to practise: skip names words to leave out', () => {
  assert.deepEqual(wordsToPractice(sentences, (x) => known.has(x), (x) => x === '学校').map((c) => c.word), ['新しい', '遠い']);
});

test('kanji focus: a kanji of a known word is known, the rest are ranked by count', () => {
  const rows = kanjiFocus(sentences, (x) => known.has(x));
  assert.ok(!rows.some((r) => r.kanji === '行'));
  assert.deepEqual(rows[0].kanji === '学' || rows[0].kanji === '校', true);
  assert.equal(rows[0].count, 2);
  assert.equal(rows.find((r) => r.kanji === '遠').word, '遠い');
});
