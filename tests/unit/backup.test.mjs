import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeValue } from '../../pwa/src/lib/backup.ts';

test('lists keep both sides, an id once, the file winning', () => {
  const have = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }];
  const file = [{ id: 'b', n: 9 }, { id: 'c', n: 3 }];
  assert.deepEqual(mergeValue(have, file), [{ id: 'b', n: 9 }, { id: 'c', n: 3 }, { id: 'a', n: 1 }]);
});

test('items without an id are not doubled', () => {
  const x = { word: '猫', at: '1' };
  assert.deepEqual(mergeValue([x], [x, { word: '犬', at: '2' }]), [x, { word: '犬', at: '2' }]);
});

test('objects merge key by key, deep', () => {
  const have = { status: { 猫: 2, 犬: 1 }, imported: { a: ['x'] } };
  const file = { status: { 猫: 4 }, imported: {} };
  assert.deepEqual(mergeValue(have, file), { status: { 猫: 4, 犬: 1 }, imported: { a: ['x'] } });
});

test('scalars: the file wins', () => {
  assert.equal(mergeValue(1, 2), 2);
  assert.equal(mergeValue('a', 'b'), 'b');
});
