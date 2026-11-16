import { api, laptopUp } from './api.ts';
import { hasLaptop } from './laptop.ts';
import { recall, remember } from './mirror.ts';
import { anilistToken, phoneJimaku, phoneJimakuKey, recentPhoneSessions } from './phone.ts';
import {
  addItem,
  isMarked,
  mark,
  markedItems,
  reconcileSeen,
  unmark,
  emptyList,
  liveItems,
  mergeLists,
  reconcile,
  removeItem,
  type ListEntry,
  type Media,
  type MediaKind,
  type Watchlist,
} from '../../../shared/watchlist.ts';
import { NOT_SHOWN, chartMedia, deleteListEntry, listEntries, matchTitles, mediaByIds, mediaDetail, recommendationsFor, saveStatus, searchMedia, seriesParts, type Chart, type MediaDetail, type Series } from '../../../shared/anilist.ts';
import { entryWeight, genreProfile, mergeSeeds, rankRecommendations, topGenres, watchedWeight, type RecEdge, type Recommendation, type Seed } from '../../../shared/recommend.ts';
import type { JimakuEntry } from '../../../shared/types.ts';
import { kitsuAnilistIds } from '../../../shared/kitsu.ts';
import { cleanTitle } from '../../../shared/chapterMatch.ts';

// The List tab on the phone: the list itself (kept here, a copy on the laptop, and the AniList Planning list when
// AniList is connected), the top charts and the recommendations. AniList is asked straight from the phone;
// answers are kept for a while so the tab opens at once and works offline.

const KEY = 'watchlist';
const now = () => new Date().toISOString();
const HOUR = 3600_000;

export const LIST_EVENT = 'horu-watchlist';
const changed = () => dispatchEvent(new Event(LIST_EVENT));

export async function loadList(): Promise<Watchlist> {
  return (await recall<Watchlist>(KEY))?.value ?? emptyList();
}

async function change(fn: (l: Watchlist) => Watchlist): Promise<Watchlist> {
  const next = fn(await loadList());
  await remember(KEY, next);
  changed();
  void syncList();
  return next;
}

export const addToList = (m: Media) => change((l) => addItem(l, m, now()));
export const removeFromList = (id: number) => change((l) => removeItem(l, id, now()));
export const notInterested = (m: Media) => change((l) => mark(l, 'dismissed', m, now()));
export const undoNotInterested = (id: number) => change((l) => unmark(l, 'dismissed', id, now()));
/** Already watched or read: off the list, out of the recommendations, a seed for them, Completed on AniList. */
export const markSeen = (m: Media) => change((l) => mark(l, 'seen', m, now()));
export const unmarkSeen = (id: number) => change((l) => unmark(l, 'seen', id, now()));

// ---- sync: laptop copy and AniList Planning ----

export type SyncState = { at?: number; error?: string; anilist: boolean };
let state: SyncState = { anilist: Boolean(anilistToken()) };
export const syncState = (): SyncState => state;

let running: Promise<void> | undefined;
let again = false;

/** Brings this phone, the laptop and AniList to the same list. Calls while one runs make one more round after it. */
export function syncList(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = syncOnce().finally(() => {
    running = undefined;
    if (again) {
      again = false;
      void syncList();
    }
  });
  return running;
}

async function syncOnce(): Promise<void> {
  let list = await loadList();
  let error: string | undefined;
  if (hasLaptop()) list = mergeLists(list, await api.watchlist().catch(() => emptyList()));

  const token = anilistToken();
  if (token) {
    try {
      const remote = await listEntries(token);
      await remember('anilist-entries', remote);
      const r = reconcile(list, remote, now());
      list = r.list;
      for (const id of r.save) {
        const entryId = await saveStatus(token, id, 'PLANNING');
        list = { ...list, items: { ...list.items, [id]: { ...list.items[id], entryId } } };
      }
      for (const entryId of r.remove) await deleteListEntry(token, entryId);
      // Seen here → Completed there (after the Planning entry above is gone); a mark taken back → that entry deleted.
      const s = reconcileSeen(list, remote);
      for (const entryId of s.drop) await deleteListEntry(token, entryId);
      for (const id of s.complete) {
        const entryId = await saveStatus(token, id, 'COMPLETED');
        list = removeItem({ ...list, seen: { ...list.seen, [id]: { ...list.seen[id], entryId } } }, id, now());
      }
    } catch (e) {
      error = (e as Error).message;
    }
  }

  // Changes made on this phone while AniList answered stay: the later change of each title wins.
  list = mergeLists(await loadList(), list);
  await remember(KEY, list);
  if (hasLaptop()) await api.putWatchlist(list).catch(() => undefined);
  state = { at: Date.now(), error, anilist: Boolean(token) };
  changed();
}

// ---- AniList answers, kept for a while ----

async function cached<T>(key: string, maxAge: number, load: () => Promise<T>, fresh = false): Promise<T> {
  const have = await recall<T>(key);
  if (have && !fresh && Date.now() - have.at < maxAge) return have.value;
  try {
    const value = await load();
    void remember(key, value);
    return value;
  } catch (e) {
    if (have) return have.value; // offline or AniList busy: the last answer
    throw e;
  }
}

/**
 * Titles for what was typed, also from its first letters: Kitsu finds "frier" → Frieren (shared/kitsu.ts), AniList
 * fills up when Kitsu has few or does not answer. No light novels among manga.
 */
async function findTitles(q: string, type: MediaKind, count: number): Promise<Media[]> {
  const ids = await kitsuAnilistIds(q, type, count).catch(() => [] as number[]);
  let out = ids.length ? await mediaByIds(ids).catch(() => [] as Media[]) : [];
  if (out.length < Math.min(4, count)) {
    const more = await searchMedia(q, type, count);
    out = [...out, ...more.filter((m) => !out.some((x) => x.id === m.id))];
  }
  return out.filter((m) => !NOT_SHOWN[type].includes(m.format ?? '')).slice(0, count);
}

export const search = (q: string, type: MediaKind) => findTitles(q, type, 15);

// Suggestions while typing: the same query is not asked twice in one visit.
const suggested = new Map<string, Promise<Media[]>>();
export function suggest(q: string, type: MediaKind): Promise<Media[]> {
  const key = `${type}:${q.toLowerCase()}`;
  let hit = suggested.get(key);
  if (!hit) {
    hit = findTitles(q, type, 8);
    hit.catch(() => suggested.delete(key));
    suggested.set(key, hit);
  }
  return hit;
}
export const chart = (c: Chart, type: MediaKind, page: number, genre: string, fresh = false) =>
  cached(`al:chart:${c}:${type}:${genre}:${page}`, 12 * HOUR, () => chartMedia(c, type, page, genre || undefined), fresh);
export const detail = (id: number): Promise<MediaDetail> => cached(`al:media3:${id}`, 24 * HOUR, () => mediaDetail(id));
/** All seasons of the series the title belongs to (AniList keeps each season apart), and its manga or anime. */
export const series = (id: number): Promise<Series> => cached(`al:series2:${id}`, 24 * HOUR, () => seriesParts(id));

/** Your AniList lists (empty without AniList). */
async function anilistLists(fresh: boolean): Promise<ListEntry[]> {
  const token = anilistToken();
  if (!token) return [];
  return cached('anilist-entries', 10 * 60_000, () => listEntries(token), fresh).catch(() => []);
}

/**
 * How far you are in a manga on AniList (chapters read), when it is on your Reading or Paused list there. Found by
 * title, so a manga Horu knows only by a source's name works too. Undefined without AniList or without an entry.
 */
export async function anilistMangaProgress(title: string): Promise<number | undefined> {
  if (!anilistToken()) return undefined;
  const id = (await resolveIds([cleanTitle(title)], 'MANGA'))[cleanTitle(title)];
  if (!id) return undefined;
  const entry = (await anilistLists(false)).find((e) => e.media.id === id && ['CURRENT', 'PAUSED', 'REPEATING'].includes(e.status));
  return entry?.progress || undefined;
}

// ---- what you watched and read in Horu ----

type History = { anime: { title: string; anilistId?: number; seconds: number; at: string }[]; manga: { title: string; at: string }[] };

async function horuHistory(): Promise<History> {
  const laptop: History = hasLaptop() ? await api.watchHistory().catch(() => ({ anime: [], manga: [] })) : { anime: [], manga: [] };
  const phone = recentPhoneSessions().map((s) => ({
    title: s.title,
    anilistId: s.anilistId,
    seconds: Object.values(s.watch ?? {}).reduce((a, b) => a + b, 0),
    at: s.createdAt,
  }));
  return { anime: [...laptop.anime, ...phone], manga: laptop.manga };
}

/** AniList ids for titles Horu only knows by name (manga from a source, anime without subtitles). Kept for good. */
async function resolveIds(titles: string[], type: MediaKind): Promise<Record<string, number>> {
  const key = 'al-ids';
  const known = (await recall<Record<string, number>>(key))?.value ?? {};
  const todo = [...new Set(titles)].filter((t) => !(`${type}:${t}` in known)).slice(0, 20);
  for (let i = 0; i < todo.length; i += 10) {
    const part = todo.slice(i, i + 10);
    const found = await matchTitles(part, type).catch(() => undefined);
    if (!found) break;
    part.forEach((t, j) => (known[`${type}:${t}`] = found[j]?.id ?? 0));
  }
  if (todo.length) await remember(key, known);
  return Object.fromEntries(titles.map((t) => [t, known[`${type}:${t}`] ?? 0]));
}

/** Ids of everything you watched or read: in Horu, and on AniList (except Planning). */
export async function startedIds(): Promise<Set<number>> {
  const [h, lists, list] = await Promise.all([horuHistory(), anilistLists(false), loadList()]);
  // An entry Horu made for a seen mark that was taken back is about to be deleted: not seen.
  const takenBack = new Set(Object.values(list.seen ?? {}).filter((m) => m.off && m.entryId).map((m) => m.entryId));
  const ids = new Set<number>(lists.filter((e) => e.status !== 'PLANNING' && !takenBack.has(e.entryId)).map((e) => e.media.id));
  markedItems(list, 'seen').forEach((m) => ids.add(m.media.id));
  h.anime.forEach((a) => a.anilistId && ids.add(a.anilistId));
  const known = (await recall<Record<string, number>>('al-ids'))?.value ?? {};
  for (const a of h.anime) if (known[`ANIME:${a.title}`]) ids.add(known[`ANIME:${a.title}`]);
  for (const m of h.manga) if (known[`MANGA:${m.title}`]) ids.add(known[`MANGA:${m.title}`]);
  return ids;
}

// ---- for you ----

export type ForYou = {
  picks: Recommendation[];
  /** The titles the picks come from, strongest first */
  seeds: Seed[];
  /** Your favourite genres and their best titles you have not seen */
  genres: string[];
  inGenres: Media[];
};

type SeedRecs = { seed?: Media; edges: RecEdge[] };

/** AniList's recommendations per seed, kept three days; new seeds are asked in calls of ten. */
async function recsFor(ids: number[], fresh: boolean): Promise<Map<number, SeedRecs>> {
  const out = new Map<number, SeedRecs>();
  const missing: number[] = [];
  for (const id of ids) {
    const have = await recall<SeedRecs>(`al:rec:${id}`);
    if (have && !fresh && Date.now() - have.at < 72 * HOUR) out.set(id, have.value);
    else missing.push(id);
  }
  for (let i = 0; i < missing.length; i += 10) {
    const part = missing.slice(i, i + 10);
    try {
      const r = await recommendationsFor(part);
      for (const id of part) {
        const value: SeedRecs = { seed: r.seeds.find((m) => m.id === id), edges: r.edges.filter((e) => e.seed === id) };
        out.set(id, value);
        void remember(`al:rec:${id}`, value);
      }
    } catch (e) {
      // AniList busy or offline: what was kept, even if old
      for (const id of part) {
        const old = await recall<SeedRecs>(`al:rec:${id}`);
        if (old) out.set(id, old.value);
      }
      if (!out.size) throw e;
    }
  }
  return out;
}

export async function forYou(type: MediaKind, fresh = false): Promise<ForYou> {
  // The list as the laptop and AniList have it, not only what this phone saw last (first open on a new device).
  await syncList().catch(() => undefined);
  const [list, lists, history] = await Promise.all([loadList(), anilistLists(fresh), horuHistory()]);
  const [animeIds, mangaIds] = await Promise.all([
    resolveIds(history.anime.filter((a) => !a.anilistId).map((a) => a.title), 'ANIME'),
    resolveIds(history.manga.map((m) => m.title), 'MANGA'),
  ]);

  const seeds: Seed[] = [];
  for (const e of lists) {
    const weight = entryWeight(e);
    if (weight) seeds.push({ id: e.media.id, title: e.media.title, weight, why: e.score ? 'rated' : e.media.type === 'ANIME' ? 'watched' : 'read' });
  }
  for (const a of history.anime) {
    const id = a.anilistId || animeIds[a.title];
    if (id) seeds.push({ id, title: a.title, weight: watchedWeight(a.seconds), why: 'watched' });
  }
  for (const m of history.manga) if (mangaIds[m.title]) seeds.push({ id: mangaIds[m.title], title: m.title, weight: 1, why: 'read' });
  for (const it of liveItems(list)) seeds.push({ id: it.id, title: it.title, weight: 0.5, why: 'listed' });
  for (const { media } of markedItems(list, 'seen')) seeds.push({ id: media.id, title: media.title, weight: 1, why: media.type === 'ANIME' ? 'watched' : 'read' });
  const top = mergeSeeds(seeds);

  const exclude = new Set<number>([...lists.map((e) => e.media.id), ...seeds.map((s) => s.id), ...markedItems(list, 'dismissed').map((d) => d.media.id), ...markedItems(list, 'seen').map((d) => d.media.id)]);
  if (!top.length) return { picks: [], seeds: [], genres: [], inGenres: [] };

  const recs = await recsFor(
    top.map((s) => s.id),
    fresh,
  );
  // AniList's own title reads better than a file or page name.
  const named = top.map((s) => (recs.get(s.id)?.seed ? { ...s, title: recs.get(s.id)!.seed!.title } : s));
  const profile = genreProfile(named.map((s) => ({ weight: s.weight, genres: recs.get(s.id)?.seed?.genres ?? [] })));
  const edges = [...recs.values()].flatMap((r) => r.edges);
  const picks = rankRecommendations(named, edges, exclude, profile)
    .filter((p) => p.media.type === type && !NOT_SHOWN[type].includes(p.media.format ?? ''))
    .slice(0, 36);

  const genres = topGenres(profile, 2);
  const shown = new Set([...exclude, ...picks.map((p) => p.media.id)]);
  const inGenres: Media[] = [];
  for (const g of genres) {
    const r = await chart('top', type, 1, g).catch(() => ({ media: [] as Media[] }));
    for (const m of r.media) {
      if (shown.has(m.id) || inGenres.length >= 12) continue;
      shown.add(m.id);
      inGenres.push(m);
    }
  }
  return { picks, seeds: named, genres, inGenres };
}

// ---- can it be watched or read in Horu ----

/** The anime's Jimaku entry (Japanese subtitles), or null. Undefined: no Jimaku key here to ask with. */
export async function subtitlesFor(m: Media): Promise<JimakuEntry | null | undefined> {
  const titles = [m.romaji ?? m.title, m.title];
  const ask = laptopUp() ? () => api.jimakuByAnilist(m.id, titles[0], titles[1]) : phoneJimakuKey() ? () => phoneJimaku.byAnilist(m.id, titles) : undefined;
  if (!ask) return undefined;
  try {
    return await cached(`jimaku:al:${m.id}`, 7 * 24 * HOUR, ask);
  } catch (e) {
    if (/key missing/i.test((e as Error).message)) return undefined;
    throw e;
  }
}

/** Opens Watch with this anime: its Jimaku entry chosen when known, else searched by title. */
export function watchHref(m: Media, entry?: JimakuEntry | null): string {
  return entry
    ? `#/watch/jimaku/${entry.id}/${m.id}/${encodeURIComponent(entry.english_name || entry.name)}`
    : `#/watch/find/${m.id}/${encodeURIComponent(m.romaji ?? m.title)}`;
}

/** Opens the manga search with the Japanese title (sources find those best). */
export const readHref = (m: Media): string => `#/manga/browse/${encodeURIComponent(m.native ?? m.romaji ?? m.title)}`;
