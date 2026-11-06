import test from 'node:test';
import assert from 'node:assert/strict';
import { coverageOf, curveOf, learnedBetween } from '../../shared/chapterScore.ts';

const words = ['犬', '猫', '犬', '走る', '犬'];

test('coverage counts every occurrence, not every different word', () => {
  assert.equal(coverageOf(words, new Set(['犬'])), 3 / 5);
  assert.equal(coverageOf(words, new Set()), 0);
  assert.equal(coverageOf([], new Set(['犬'])), 0);
});

test('learned: different words known now that were not before', () => {
  assert.equal(learnedBetween(words, new Set(['犬']), new Set(['犬', '猫', '走る'])), 2);
  assert.equal(learnedBetween(words, new Set(['犬']), new Set(['犬'])), 0);
  assert.equal(learnedBetween(['猫', '猫'], new Set(), new Set(['猫'])), 1, 'a word counts once');
});

test('curve: one dot per chapter, rising values rise on screen, the scale uses the height', () => {
  const c = curveOf([61, 75, 94], 280, 76);
  assert.equal(c.dots.length, 3);
  assert.ok(c.dots[0].y > c.dots[1].y && c.dots[1].y > c.dots[2].y, 'higher understanding is higher up');
  assert.ok(c.dots[0].x < c.dots[2].x);
  assert.ok(c.dots[2].y < 20 && c.dots[0].y > 56, 'the climb fills the height');
  assert.match(c.path, /^M[\d. ]+( C[\d. ]+)+$/);
  assert.equal(curveOf([], 280, 76).path, '');
  assert.equal(curveOf([80], 280, 76).dots[0].x, 140);
});
