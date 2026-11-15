// The List tab: anime and manga you still want to watch or read, and the recommendations around it.
// The phone keeps the list; the laptop keeps a copy (backup, a second device), and with AniList connected it is
// the user's AniList "Planning" list too. Copies merge per title: the later change wins.

export type MediaKind = 'ANIME' | 'MANGA';

/** One title as AniList describes it, cut down to what the list and the recommendations show. */
export type Media = {
  /** AniList id (unique across anime and manga) */
  id: number;
  type: MediaKind;
  /** English title when there is one, else romaji */
  title: string;
  romaji?: string;
  native?: string;
  cover?: string;
  color?: string;
  /** AniList average score, 0-100 */
  score?: number;
  popularity?: number;
  genres: string[];
  year?: number;
  /** TV, MOVIE, MANGA, ONE_SHOT, NOVEL, … */
  format?: string;
  episodes?: number;
  chapters?: number;
};

export type WatchItem = Media & {
  addedAt: string;
  /** Last change (added, taken off): the later one wins when copies merge */
  at: string;
  /** Taken off the list. Kept as a marker so another copy does not bring it back. */
  removed?: boolean;
  /** The AniList list entry, once it is on the AniList list as Planning */
  entryId?: number;
};

/** A title you said "Not interested" to. `off`: you changed your mind (kept so another copy does not bring it back). */
export type Dismissed = { media: Media; at: string; off?: boolean };

export type Watchlist = {
  items: Record<string, WatchItem>;
  /** Recommendations you said no to, by id */
  dismissed: Record<string, Dismissed>;
};

export const emptyList = (): Watchlist => ({ items: {}, dismissed: {} });

/** What is on the list, newest first. */
export const liveItems = (list: Watchlist): WatchItem[] =>
  Object.values(list.items)
    .filter((i) => !i.removed)
    .sort((a, b) => b.addedAt.localeCompare(a.addedAt));

export const onList = (list: Watchlist, id: number): boolean => Boolean(list.items[id] && !list.items[id].removed);

export function addItem(list: Watchlist, media: Media, now: string): Watchlist {
  const had = list.items[media.id];
  if (had && !had.removed) return list;
  return { ...list, items: { ...list.items, [media.id]: { ...media, addedAt: now, at: now, entryId: had?.entryId } } };
}

export function removeItem(list: Watchlist, id: number, now: string): Watchlist {
  const had = list.items[id];
  if (!had || had.removed) return list;
  return { ...list, items: { ...list.items, [id]: { ...had, removed: true, at: now } } };
}

export const isDismissed = (list: Watchlist, id: number): boolean => Boolean(list.dismissed[id] && !list.dismissed[id].off);

/** The "Not interested" list, the latest first. */
export const dismissedItems = (list: Watchlist): Dismissed[] =>
  Object.values(list.dismissed)
    .filter((d) => !d.off)
    .sort((a, b) => b.at.localeCompare(a.at));

export function dismiss(list: Watchlist, media: Media, now: string): Watchlist {
  return { ...list, dismissed: { ...list.dismissed, [media.id]: { media, at: now } } };
}

export function undismiss(list: Watchlist, id: number, now: string): Watchlist {
  const had = list.dismissed[id];
  if (!had || had.off) return list;
  return { ...list, dismissed: { ...list.dismissed, [id]: { ...had, at: now, off: true } } };
}

export function mergeLists(a: Watchlist, b: Watchlist): Watchlist {
  const items = { ...a.items };
  for (const [k, theirs] of Object.entries(b.items)) {
    const mine = items[k];
    if (!mine || theirs.at > mine.at) items[k] = theirs;
    else if (theirs.at === mine.at && mine.entryId === undefined && theirs.entryId !== undefined) items[k] = { ...mine, entryId: theirs.entryId };
  }
  const dismissed = { ...a.dismissed };
  for (const [k, theirs] of Object.entries(b.dismissed)) if (!dismissed[k] || theirs.at > dismissed[k].at) dismissed[k] = theirs;
  return { items, dismissed };
}

// ---- checking what comes from outside (the laptop takes the list from any paired device) ----

const KINDS = new Set(['ANIME', 'MANGA']);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const int = (x: unknown, max = 2 ** 31): number | undefined => (Number.isInteger(x) && (x as number) >= 0 && (x as number) <= max ? (x as number) : undefined);
const str = (x: unknown, n: number): string | undefined => (typeof x === 'string' && x.trim() ? x.trim().slice(0, n) : undefined);

export function cleanMedia(x: unknown): Media | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const m = x as Record<string, unknown>;
  const id = int(m.id);
  const title = str(m.title, 300);
  if (!id || !title || !KINDS.has(m.type as string)) return undefined;
  const cover = str(m.cover, 500);
  return {
    id,
    type: m.type as MediaKind,
    title,
    romaji: str(m.romaji, 300),
    native: str(m.native, 300),
    cover: cover && /^https:\/\//.test(cover) ? cover : undefined,
    color: str(m.color, 9)?.match(/^#[0-9a-f]{3,8}$/i)?.[0],
    score: int(m.score, 100),
    popularity: int(m.popularity),
    genres: Array.isArray(m.genres) ? m.genres.map((g) => str(g, 40)).filter((g): g is string => Boolean(g)).slice(0, 12) : [],
    year: int(m.year, 3000),
    format: str(m.format, 20),
    episodes: int(m.episodes, 100000),
    chapters: int(m.chapters, 100000),
  };
}

export function cleanList(input: unknown): Watchlist {
  const out = emptyList();
  if (!input || typeof input !== 'object') return out;
  const { items, dismissed } = input as { items?: unknown; dismissed?: unknown };
  if (items && typeof items === 'object') {
    for (const raw of Object.values(items as Record<string, Record<string, unknown>>).slice(0, 5000)) {
      const media = cleanMedia(raw);
      if (!media || !ISO.test(String(raw.at)) || !ISO.test(String(raw.addedAt))) continue;
      out.items[media.id] = { ...media, addedAt: String(raw.addedAt), at: String(raw.at), removed: raw.removed === true || undefined, entryId: int(raw.entryId) };
    }
  }
  if (dismissed && typeof dismissed === 'object')
    for (const raw of Object.values(dismissed as Record<string, Record<string, unknown>>).slice(0, 5000)) {
      const media = cleanMedia(raw?.media);
      if (!media || !ISO.test(String(raw.at))) continue;
      out.dismissed[media.id] = { media, at: String(raw.at), off: raw.off === true || undefined };
    }
  return out;
}

// ---- AniList ----

/** One entry of the user's AniList lists. `updatedAt` in seconds, as AniList gives it; `score` 0-100 (0 = none). */
export type ListEntry = { entryId: number; status: string; updatedAt: number; score: number; progress: number; media: Media };

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

/**
 * Brings the list and the AniList lists together. Planning entries on AniList join the list; titles on the list
 * that AniList does not have yet are to be saved as Planning (`save`); titles taken off here are deleted from
 * AniList (`remove`, list entry ids). A title started or finished on AniList after it was put on the list leaves
 * the list; one taken off AniList's Planning list leaves it too.
 */
export function reconcile(list: Watchlist, remote: ListEntry[], now: string): { list: Watchlist; save: number[]; remove: number[] } {
  const items = { ...list.items };
  const save: number[] = [];
  const remove: number[] = [];
  const byId = new Map(remote.map((e) => [e.media.id, e]));

  for (const e of remote) {
    if (e.status !== 'PLANNING') continue;
    const it = items[e.media.id];
    const changed = iso(e.updatedAt);
    if (!it || (it.removed && changed > it.at)) items[e.media.id] = { ...e.media, addedAt: changed, at: changed, entryId: e.entryId };
    else if (it.removed) {
      remove.push(e.entryId);
      items[e.media.id] = { ...it, entryId: undefined };
    } else items[e.media.id] = { ...it, entryId: e.entryId };
  }

  for (const it of Object.values(items)) {
    if (it.removed) continue;
    const e = byId.get(it.id);
    if (!e) {
      if (it.entryId) items[it.id] = { ...it, removed: true, at: now, entryId: undefined };
      else save.push(it.id);
    } else if (e.status !== 'PLANNING' && iso(e.updatedAt) > it.at) items[it.id] = { ...it, removed: true, at: now, entryId: undefined };
  }
  return { list: { ...list, items }, save, remove };
}
