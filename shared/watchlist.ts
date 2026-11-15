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

/**
 * A title you marked: "Not interested" (`dismissed`) or "Seen / read" (`seen`). `off`: you took the mark back (kept so
 * another copy does not bring it back). `entryId`: the AniList entry Horu made for a seen title (set to Completed).
 */
export type Marked = { media: Media; at: string; off?: boolean; entryId?: number };
export type MarkKind = 'dismissed' | 'seen';

export type Watchlist = {
  items: Record<string, WatchItem>;
  /** Recommendations you said no to, by id */
  dismissed: Record<string, Marked>;
  /** Titles you marked as already watched or read, by id */
  seen: Record<string, Marked>;
};

export const emptyList = (): Watchlist => ({ items: {}, dismissed: {}, seen: {} });

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

const marks = (list: Watchlist, kind: MarkKind): Record<string, Marked> => list[kind] ?? {};

export const isMarked = (list: Watchlist, kind: MarkKind, id: number): boolean => Boolean(marks(list, kind)[id] && !marks(list, kind)[id].off);

/** The marked titles, the latest first. */
export const markedItems = (list: Watchlist, kind: MarkKind): Marked[] =>
  Object.values(marks(list, kind))
    .filter((d) => !d.off)
    .sort((a, b) => b.at.localeCompare(a.at));

/** Marks a title. Seen takes it off the list too: there is nothing left to watch. */
export function mark(list: Watchlist, kind: MarkKind, media: Media, now: string): Watchlist {
  // A new mark starts without an AniList entry: one Horu made earlier may be gone since.
  const next = { ...list, [kind]: { ...marks(list, kind), [media.id]: { media, at: now } } };
  return kind === 'seen' ? removeItem(next, media.id, now) : next;
}

export function unmark(list: Watchlist, kind: MarkKind, id: number, now: string): Watchlist {
  const had = marks(list, kind)[id];
  if (!had || had.off) return list;
  return { ...list, [kind]: { ...marks(list, kind), [id]: { ...had, at: now, off: true } } };
}

function mergeMarks(a: Record<string, Marked> = {}, b: Record<string, Marked> = {}): Record<string, Marked> {
  const out = { ...a };
  for (const [k, theirs] of Object.entries(b)) {
    const mine = out[k];
    if (!mine || theirs.at > mine.at) out[k] = theirs;
    else if (theirs.at === mine.at && mine.entryId === undefined && theirs.entryId !== undefined) out[k] = { ...mine, entryId: theirs.entryId };
  }
  return out;
}

export function mergeLists(a: Watchlist, b: Watchlist): Watchlist {
  const items = { ...a.items };
  for (const [k, theirs] of Object.entries(b.items)) {
    const mine = items[k];
    if (!mine || theirs.at > mine.at) items[k] = theirs;
    else if (theirs.at === mine.at && mine.entryId === undefined && theirs.entryId !== undefined) items[k] = { ...mine, entryId: theirs.entryId };
  }
  return { items, dismissed: mergeMarks(a.dismissed, b.dismissed), seen: mergeMarks(a.seen, b.seen) };
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
  const { items } = input as { items?: unknown };
  if (items && typeof items === 'object') {
    for (const raw of Object.values(items as Record<string, Record<string, unknown>>).slice(0, 5000)) {
      const media = cleanMedia(raw);
      if (!media || !ISO.test(String(raw.at)) || !ISO.test(String(raw.addedAt))) continue;
      out.items[media.id] = { ...media, addedAt: String(raw.addedAt), at: String(raw.at), removed: raw.removed === true || undefined, entryId: int(raw.entryId) };
    }
  }
  for (const kind of ['dismissed', 'seen'] as const) {
    const raw = (input as Record<string, unknown>)[kind];
    if (!raw || typeof raw !== 'object') continue;
    for (const m of Object.values(raw as Record<string, Record<string, unknown>>).slice(0, 5000)) {
      const media = cleanMedia(m?.media);
      if (!media || !ISO.test(String(m.at))) continue;
      out[kind][media.id] = { media, at: String(m.at), off: m.off === true || undefined, entryId: int(m.entryId) };
    }
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

/**
 * Seen titles and AniList: a title marked seen here that AniList does not have (or only plans) is to be set to
 * Completed there (`complete`, media ids). Taking the mark back deletes the entry Horu made, but only while it is
 * still the plain Completed entry without a score of yours (`drop`, list entry ids).
 */
export function reconcileSeen(list: Watchlist, remote: ListEntry[]): { complete: number[]; drop: number[] } {
  const byId = new Map(remote.map((e) => [e.media.id, e]));
  const complete: number[] = [];
  const drop: number[] = [];
  for (const m of Object.values(list.seen ?? {})) {
    const e = byId.get(m.media.id);
    if (!m.off) {
      if (!m.entryId && (!e || e.status === 'PLANNING')) complete.push(m.media.id);
    } else if (m.entryId && e && e.entryId === m.entryId && e.status === 'COMPLETED' && !e.score) drop.push(m.entryId);
  }
  return { complete, drop };
}
