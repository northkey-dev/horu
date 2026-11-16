import test from 'node:test';
import assert from 'node:assert/strict';
import { chapterNumbers, cleanTitle, sameChapter } from '../../shared/chapterMatch.ts';

test('chapterNumbers: Japanese and English ways to name a chapter or volume', () => {
  assert.deepEqual(chapterNumbers('第12話'), { chapter: 12, volume: undefined });
  assert.deepEqual(chapterNumbers('第１２話 悪魔'), { chapter: 12, volume: undefined });
  assert.deepEqual(chapterNumbers('Chapter 12: Dog and Chainsaw'), { chapter: 12, volume: undefined });
  assert.deepEqual(chapterNumbers('Vol.2 Ch.12.5 - Extra'), { chapter: 12.5, volume: 2 });
  assert.deepEqual(chapterNumbers('#108'), { chapter: 108, volume: undefined });
  assert.deepEqual(chapterNumbers('Chainsaw Man v03'), { chapter: undefined, volume: 3 });
  assert.deepEqual(chapterNumbers('チェンソーマン 第3巻'), { chapter: undefined, volume: 3 });
  assert.deepEqual(chapterNumbers('Chainsaw Man 12'), { chapter: 12, volume: undefined });
  assert.deepEqual(chapterNumbers('Devil arc'), { chapter: undefined, volume: undefined });
});

test('sameChapter: chapters by chapter, whole volumes by volume', () => {
  assert.equal(sameChapter(chapterNumbers('第12話'), chapterNumbers('Chapter 12')), true);
  assert.equal(sameChapter(chapterNumbers('第12話'), chapterNumbers('Chapter 13')), false);
  assert.equal(sameChapter(chapterNumbers('第3巻'), chapterNumbers('Vol. 3')), true);
  assert.equal(sameChapter(chapterNumbers('第3巻'), chapterNumbers('Chapter 3')), false);
  assert.equal(sameChapter(chapterNumbers('Devil arc'), chapterNumbers('Devil arc')), false);
});

test('cleanTitle: what a file name adds to a title goes', () => {
  assert.equal(cleanTitle('Chainsaw Man v01 [Viz Digital]'), 'Chainsaw Man');
  assert.equal(cleanTitle('チェンソーマン 第1巻'), 'チェンソーマン');
  assert.equal(cleanTitle('Frieren_-_12'), 'Frieren');
  assert.equal(cleanTitle('Yotsuba&! (2003)'), 'Yotsuba&!');
  assert.equal(cleanTitle('86'), '86');
});
