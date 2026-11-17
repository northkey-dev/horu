import test from 'node:test';
import assert from 'node:assert/strict';
import { isVolumeBundle, keptFor, passedOver, pickChapters } from '../../shared/sourceChapters.ts';

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

test('pickChapters: an uploader tag in place of the title takes the title of the twin', () => {
  const { chapters } = pickChapters([
    c(1, 4, 'Ch. 4 - Sorcery and the Enchanted Blade', 'unofficial'),
    c(2, 4, 'Ch. 4 - (1r0n)', 'official'),
    c(3, 5, 'Ch. 5 - (1r0n)', 'official'),
    c(4, 137, 'Ch. 137', 'unofficial'),
    c(5, 137, 'Ch. 137 - Fork', 'official'),
    c(6, 138, 'Ch. 138 - Heavy Charge', 'unofficial'),
    c(7, 138, 'Ch. 138', 'official'),
  ]);
  assert.deepEqual(
    chapters.map((x) => [x.id, x.name]),
    [
      [2, 'Ch. 4 - Sorcery and the Enchanted Blade'],
      [3, 'Ch. 5 - (1r0n)'],
      [5, 'Ch. 137 - Fork'],
      [7, 'Ch. 138 - Heavy Charge'],
    ],
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

test('passedOver: unread chapters between the first read one and your place', () => {
  // As Kagurabachi was left: 1 and 2 read, then the reader went on to the next prepared chapter, 8.
  const all = [1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((n) => [
    { ...c(n * 10, n, `Ch. ${n}`, 'unofficial'), isRead: false },
    { ...c(n * 10 + 1, n, `Ch. ${n}`, 'official'), isRead: n === 1 || n === 8 },
  ]);
  const sorted = pickChapters(all).chapters;
  const at8 = sorted.findIndex((x) => x.chapterNumber === 8);
  // Chapter 2 read in Horu only, through its fan twin
  const missed = passedOver(all, sorted, at8, (x) => x.id === 20);
  assert.deepEqual(missed.map((x) => x.chapterNumber), [3, 4, 5, 6, 7]);
  // Nothing read before your place (you opened chapter 8 first, or set your place there): nothing passed over
  assert.deepEqual(passedOver(all.map((x) => ({ ...x, isRead: false })), sorted, at8, () => false), []);
  // Your place right after the chapters read: nothing
  assert.deepEqual(passedOver(all, sorted, 1, () => false), []);
});
