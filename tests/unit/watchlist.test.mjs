import test from 'node:test';
import assert from 'node:assert/strict';
import { addItem, cleanList, emptyList, isMarked, liveItems, mark, markedItems, mergeLists, onList, reconcile, reconcileSeen, removeItem, unmark } from '../../shared/watchlist.ts';
import { creatorsOf } from '../../shared/anilist.ts';

const dismiss = (l, m, at) => mark(l, 'dismissed', m, at);
const undismiss = (l, id, at) => unmark(l, 'dismissed', id, at);
const isDismissed = (l, id) => isMarked(l, 'dismissed', id);
const dismissedItems = (l) => markedItems(l, 'dismissed');
import { entryWeight, genreProfile, mergeSeeds, rankRecommendations, topGenres, watchedWeight } from '../../shared/recommend.ts';

const media = (id, extra = {}) => ({ id, type: 'ANIME', title: `T${id}`, genres: [], ...extra });
const T1 = '2026-11-01T10:00:00.000Z';
const T2 = '2026-11-02T10:00:00.000Z';
const T3 = '2026-11-03T10:00:00.000Z';
const sec = (iso) => Date.parse(iso) / 1000;

test('add and remove: taking a title off leaves a marker, putting it back revives it', () => {
  let l = addItem(emptyList(), media(1), T1);
  assert.deepEqual(liveItems(l).map((i) => i.id), [1]);
  l = removeItem(l, 1, T2);
  assert.equal(liveItems(l).length, 0);
  assert.equal(l.items[1].removed, true);
  l = addItem(l, media(1), T3);
  assert.equal(liveItems(l).length, 1);
  assert.equal(l.items[1].addedAt, T3);
});

test('two copies merge per title, the later change wins', () => {
  const phone = removeItem(addItem(emptyList(), media(1), T1), 1, T3);
  const laptop = addItem(addItem(emptyList(), media(1), T2), media(2), T2);
  const merged = mergeLists(phone, laptop);
  assert.deepEqual(liveItems(merged).map((i) => i.id), [2], 'removal at T3 beats the add at T2');
  assert.deepEqual(mergeLists(laptop, phone), merged, 'order does not matter');
});

test('a merge at the same moment keeps the AniList entry id one copy learned', () => {
  const a = addItem(emptyList(), media(1), T1);
  const b = { ...a, items: { 1: { ...a.items[1], entryId: 99 } } };
  assert.equal(mergeLists(a, b).items[1].entryId, 99);
});

test('clean: drops what is not a list entry', () => {
  const l = cleanList({
    items: {
      1: { ...media(1, { cover: 'javascript:alert(1)', score: 300 }), addedAt: T1, at: T1 },
      2: { id: 2, type: 'BOOK', title: 'x', addedAt: T1, at: T1 },
      3: { ...media(3), addedAt: 'yesterday', at: T1 },
    },
    dismissed: { 4: { media: media(4), at: T1 }, 9: { at: T1 }, 10: { media: media(10), at: 'nope' } },
  });
  assert.deepEqual(Object.keys(l.items), ['1']);
  assert.equal(l.items[1].cover, undefined);
  assert.equal(l.items[1].score, undefined);
  assert.deepEqual(Object.keys(l.dismissed), ['4']);
});

test('not interested: listed with its title, undo survives a merge with an older copy', () => {
  const said = dismiss(emptyList(), media(4), T1);
  assert.equal(isDismissed(said, 4), true);
  assert.deepEqual(dismissedItems(said).map((d) => d.media.title), ['T4']);
  const changed = undismiss(said, 4, T2);
  assert.equal(isDismissed(changed, 4), false);
  assert.equal(dismissedItems(changed).length, 0);
  assert.equal(isDismissed(mergeLists(said, changed), 4), false, 'the older "no" from the laptop does not come back');
  assert.equal(isDismissed(mergeLists(changed, dismiss(changed, media(4), T3)), 4), true, 'saying no again later counts');
});

test('seen: takes the title off the list, survives merges, can be taken back', () => {
  let l = addItem(emptyList(), media(7), T1);
  l = mark(l, 'seen', media(7), T2);
  assert.equal(onList(l, 7), false, 'nothing left to watch');
  assert.equal(isMarked(l, 'seen', 7), true);
  const back = unmark(l, 'seen', 7, T3);
  assert.equal(isMarked(back, 'seen', 7), false);
  assert.equal(isMarked(mergeLists(l, back), 'seen', 7), false, 'the older mark does not come back');
  assert.equal(isMarked(cleanList(JSON.parse(JSON.stringify(l))), 'seen', 7), true, 'the laptop keeps it');
  assert.equal(isMarked(cleanList({ items: {}, dismissed: {} }), 'seen', 7), false, 'an old copy without seen marks is fine');
});

test('seen and AniList: Completed there unless AniList has it already; taking it back deletes only our plain entry', () => {
  let l = mark(emptyList(), 'seen', media(1), T1); // AniList does not know it
  l = mark(l, 'seen', media(2), T1); // planned there
  l = mark(l, 'seen', media(3), T1); // already completed there
  const remote = [
    { entryId: 20, status: 'PLANNING', updatedAt: sec(T1), score: 0, progress: 0, media: media(2) },
    { entryId: 30, status: 'COMPLETED', updatedAt: sec(T1), score: 80, progress: 12, media: media(3) },
  ];
  assert.deepEqual(reconcileSeen(l, remote), { complete: [1, 2], drop: [] });

  let ours = mark(emptyList(), 'seen', media(4), T1);
  ours = { ...ours, seen: { 4: { ...ours.seen[4], entryId: 40 } } };
  ours = unmark(ours, 'seen', 4, T2);
  const plain = [{ entryId: 40, status: 'COMPLETED', updatedAt: sec(T1), score: 0, progress: 0, media: media(4) }];
  assert.deepEqual(reconcileSeen(ours, plain).drop, [40]);
  const rated = [{ ...plain[0], score: 70 }];
  assert.deepEqual(reconcileSeen(ours, rated).drop, [], 'a score you gave there stays');
  assert.equal(mark(ours, 'seen', media(4), T3).seen[4].entryId, undefined, 'marking again asks AniList again');
});

test('creators: the mangaka, not assistants or translators', () => {
  const edge = (role, full, native = null) => ({ role, node: { name: { full, native } } });
  const c = creatorsOf([
    edge('Story & Art', 'Eiichirou Oda', '尾田栄一郎'),
    edge('Assistant (Former)', 'Someone', '誰か'),
    edge('Translator (English)', 'Amy'),
    edge('Story', 'Writer A', 'A'),
    edge('Art (Chapters 1-10)', 'Writer A', 'A'),
  ]);
  assert.deepEqual(c, [
    { name: 'Eiichirou Oda', native: '尾田栄一郎', roles: ['Story & Art'] },
    { name: 'Writer A', native: 'A', roles: ['Story', 'Art'] },
  ]);
});

test('AniList: Planning joins the list, new titles are saved, removed ones deleted', () => {
  let l = addItem(emptyList(), media(1), T2); // only here
  l = removeItem(addItem(l, media(2), T1), 2, T3); // taken off here after AniList planned it
  const remote = [
    { entryId: 20, status: 'PLANNING', updatedAt: sec(T1), score: 0, progress: 0, media: media(2) },
    { entryId: 30, status: 'PLANNING', updatedAt: sec(T2), score: 0, progress: 0, media: media(3) },
  ];
  const r = reconcile(l, remote, T3);
  assert.deepEqual(r.save, [1]);
  assert.deepEqual(r.remove, [20]);
  assert.deepEqual(liveItems(r.list).map((i) => i.id).sort(), [1, 3]);
  assert.equal(r.list.items[3].entryId, 30);
});

test('AniList: starting a title there takes it off the list; one listed here after watching stays', () => {
  let l = addItem(emptyList(), media(1), T1);
  l = { ...l, items: { 1: { ...l.items[1], entryId: 10 } } };
  l = addItem(l, media(2), T3);
  const remote = [
    { entryId: 10, status: 'CURRENT', updatedAt: sec(T2), score: 0, progress: 3, media: media(1) },
    { entryId: 11, status: 'COMPLETED', updatedAt: sec(T1), score: 80, progress: 12, media: media(2) },
  ];
  const r = reconcile(l, remote, T3);
  assert.equal(r.list.items[1].removed, true);
  assert.equal(r.list.items[2].removed, undefined);
  assert.deepEqual(r.save, [], 'a watched title is not set back to Planning');
});

test('AniList: a title taken off AniList Planning leaves the list', () => {
  const l = { ...emptyList(), items: { 5: { ...media(5), addedAt: T1, at: T1, entryId: 50 } } };
  const r = reconcile(l, [], T2);
  assert.equal(r.list.items[5].removed, true);
  assert.deepEqual(r.save, []);
});

test('seed weights: ratings count, low ratings and plans do not', () => {
  assert.equal(entryWeight({ status: 'PLANNING', score: 0 }), 0);
  assert.equal(entryWeight({ status: 'DROPPED', score: 90 }), 0);
  assert.equal(entryWeight({ status: 'COMPLETED', score: 40 }), 0);
  assert.ok(entryWeight({ status: 'COMPLETED', score: 95 }) > entryWeight({ status: 'COMPLETED', score: 70 }));
  assert.equal(entryWeight({ status: 'COMPLETED', score: 0 }), 1);
  assert.ok(watchedWeight(10 * 3600) > watchedWeight(600));
  assert.equal(watchedWeight(100 * 3600), 2);
  assert.deepEqual(
    mergeSeeds([
      { id: 1, title: 'a', weight: 0.5, why: 'listed' },
      { id: 1, title: 'a', weight: 1.5, why: 'rated' },
    ]).map((s) => s.why),
    ['rated'],
  );
});

test('ranking: shared recommendations add up, seen titles stay out, genres tilt', () => {
  const seeds = [
    { id: 1, title: 'A', weight: 1, why: 'watched' },
    { id: 2, title: 'B', weight: 2, why: 'rated' },
  ];
  const profile = genreProfile([
    { weight: 1, genres: ['Drama'] },
    { weight: 2, genres: ['Drama', 'Romance'] },
  ]);
  assert.deepEqual(topGenres(profile, 1), ['Drama']);
  const edges = [
    { seed: 1, rating: 50, media: media(10, { genres: ['Action'], score: 80 }) },
    { seed: 1, rating: 40, media: media(11, { genres: ['Drama'], score: 80 }) },
    { seed: 2, rating: 40, media: media(11, { genres: ['Drama'], score: 80 }) },
    { seed: 2, rating: 60, media: media(12, { genres: ['Drama'], score: 80 }) },
    { seed: 2, rating: 99, media: media(1) }, // a seed itself
    { seed: 1, rating: 99, media: media(13) }, // already seen
  ];
  const picks = rankRecommendations(seeds, edges, new Set([13]), profile);
  assert.deepEqual(picks.map((p) => p.media.id), [11, 12, 10]);
  assert.deepEqual(picks[0].because.map((b) => b.title), ['B', 'A'], 'strongest reason first');
});
