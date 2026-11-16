import test from 'node:test';
import assert from 'node:assert/strict';
import { isVolumeBundle, keptFor, pickChapters } from '../../shared/sourceChapters.ts';

// As MangaFire (EN) lists Kagurabachi: a whole volume as chapter 0, every chapter twice.
const c = (id, chapterNumber, name, scanlator, uploadDate = '1') => ({ id, chapterNumber, name, scanlator, uploadDate, sourceOrder: id });
const list = [
  c(1340, 0, 'Ch. 0 - Volume 8', 'unofficial', '1787702492000'),
  c(1341, 1, 'Ch. 1 - Mission', 'unofficial', '1757155519000'),
  c(1342, 1, 'Ch. 1 - Mission', 'official', '1783305693000'),
  c(1343, 2, 'Ch. 2 - Heaps', 'official', '1783305693000'),
  c(1344, 2, 'Ch. 2 - Heaps', 'unofficial', '1757155519000'),
  c(1345, 3, 'Ch. 3', 'unofficial', '1'),
  c(1346, 3, 'Ch. 3', 'unofficial', '2'),
  c(1347, -1, 'Extra', null),
  c(1348, -1, 'Extra 2', null),
];

test('pickChapters: one per number, the official one; whole volumes apart', () => {
  const { chapters, volumes } = pickChapters(list);
  assert.deepEqual(
    chapters.map((x) => x.id),
    [1342, 1343, 1346, 1347, 1348],
  );
  assert.deepEqual(
    volumes.map((x) => x.id),
    [1340],
  );
});

test('isVolumeBundle: only a volume without a chapter number of its own', () => {
  assert.equal(isVolumeBundle(c(1, 0, 'Ch. 0 - Volume 8')), true);
  assert.equal(isVolumeBundle(c(1, 0, 'Vol.3')), true);
  assert.equal(isVolumeBundle(c(1, 0, 'Chapter 0: Prologue')), false);
  assert.equal(isVolumeBundle(c(1, 12, 'Vol.2 Ch.12')), false);
});

test('keptFor: a place in a left-out duplicate moves to the kept chapter', () => {
  const { chapters } = pickChapters(list);
  assert.equal(keptFor(list, chapters, 1341).id, 1342);
  assert.equal(keptFor(list, chapters, 1342).id, 1342);
  assert.equal(keptFor(list, chapters, 1340), undefined);
  assert.equal(keptFor(list, chapters, 9999), undefined);
});
