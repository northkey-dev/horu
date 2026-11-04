import test from 'node:test';
import assert from 'node:assert/strict';
import { exampleScore, isFiller } from '../../server/src/wordrank.ts';

test('fillers: interjections, short kana sounds and clipped laughter are skipped', () => {
  assert.equal(isFiller({ word: 'あっ' }), true);
  assert.equal(isFiller({ word: 'うーん', pos: '感動詞' }), true);
  assert.equal(isFiller({ word: 'はっはっ' }), true); // ends in a clipped っ
  assert.equal(isFiller({ word: 'まあ', pos: '副詞' }), true); // two kana
});

test('fillers: real vocabulary stays', () => {
  for (const word of ['助ける', 'ブルース', 'ありがとう', '食う', 'ファン']) assert.equal(isFiller({ word }), false, word);
});

test('example sentences: prefers a short line with the word written out over a long or clipped one', () => {
  const good = exampleScore('賞金稼ぎは命がけだ', '賞金', '賞金');
  assert.ok(good > exampleScore('賞金', '賞金', '賞金'), 'fragment loses');
  assert.ok(good > exampleScore('賞金稼ぎは命がけだ'.repeat(6), '賞金', '賞金'), 'long speech loses');
  assert.ok(good > exampleScore('賞金稼ぎは命がけだ', '賞金首', '賞金'.replace('賞金', 'x')), 'word not in the line loses');
});
