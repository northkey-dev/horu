import type { ListEntry, Media, MediaKind } from './watchlist.ts';
import type { RecEdge } from './recommend.ts';

// AniList: ticks off watched episodes in the user's list, and feeds the List tab (search, top lists,
// recommendations, the Planning list). Works from the laptop and from the phone (AniList allows browser calls).
// The token comes from AniList's implicit login with a client id of the user's own (anilist.co/settings/developer,
// redirect URL = the app's address), or is pasted. Calls without a token send nothing about the user.

const URL = 'https://graphql.anilist.co';

export const anilistLoginUrl = (clientId: string) => `https://anilist.co/api/v2/oauth/authorize?client_id=${encodeURIComponent(clientId)}&response_type=token`;

// AniList allows about 30-90 calls a minute. Calls go one after another with a short gap, and a "too many"
// answer waits as long as AniList asks (at most a minute) before the one retry.
const GAP_MS = 350;
let queue: Promise<unknown> = Promise.resolve();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function gql<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const run = async (retry: boolean): Promise<T> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (token.trim()) headers.Authorization = `Bearer ${token.trim()}`;
    const res = await fetch(URL, { method: 'POST', headers, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(15_000) });
    if (res.status === 429 && retry) {
      await wait(Math.min(60, Number(res.headers.get('Retry-After')) || 30) * 1000);
      return run(false);
    }
    const data = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message: string }[] };
    if (res.status === 429) throw new Error('AniList: too many requests right now. Try again in a minute.');
    if (!res.ok || data.errors?.length) throw new Error(`AniList: ${data.errors?.[0]?.message ?? `HTTP ${res.status}`}`);
    return data.data as T;
  };
  const turn = queue.then(() => run(true));
  queue = turn.then(
    () => wait(GAP_MS),
    () => wait(GAP_MS),
  );
  return turn;
}

export async function anilistViewer(token: string): Promise<string> {
  return (await gql<{ Viewer: { name: string } }>(token, 'query { Viewer { name } }', {})).Viewer.name;
}

/**
 * Sets the progress of an anime to `episode` unless the list is already further. Marks it completed at the
 * last episode. Returns the progress AniList now has.
 */
export async function anilistWatched(token: string, mediaId: number, episode: number): Promise<number> {
  const { Media } = await gql<{ Media: { episodes: number | null; mediaListEntry: { progress: number; status: string } | null } }>(
    token,
    'query ($id: Int) { Media(id: $id) { episodes mediaListEntry { progress status } } }',
    { id: mediaId },
  );
  const current = Media.mediaListEntry?.progress ?? 0;
  if (current >= episode) return current;
  const status = Media.episodes && episode >= Media.episodes ? 'COMPLETED' : 'CURRENT';
  const { SaveMediaListEntry } = await gql<{ SaveMediaListEntry: { progress: number } }>(
    token,
    'mutation ($id: Int, $p: Int, $s: MediaListStatus) { SaveMediaListEntry(mediaId: $id, progress: $p, status: $s) { progress } }',
    { id: mediaId, p: episode, s: status },
  );
  return SaveMediaListEntry.progress;
}

/** Watched enough of an episode to tick it off: two thirds of a usual 24-minute episode. */
export const WATCHED_SECONDS = 16 * 60;

// ---------------------------------------------------------------- the List tab

const FIELDS = 'id type format title { romaji english native } coverImage { large color } averageScore popularity genres episodes chapters seasonYear startDate { year }';

type RawMedia = {
  id: number;
  type: MediaKind;
  format?: string | null;
  title: { romaji?: string | null; english?: string | null; native?: string | null };
  coverImage?: { large?: string | null; color?: string | null } | null;
  averageScore?: number | null;
  popularity?: number | null;
  genres?: string[] | null;
  episodes?: number | null;
  chapters?: number | null;
  seasonYear?: number | null;
  startDate?: { year?: number | null } | null;
};

const opt = <T>(x: T | null | undefined): T | undefined => (x === null ? undefined : x);

export function toMedia(m: RawMedia): Media {
  return {
    id: m.id,
    type: m.type,
    title: m.title.english || m.title.romaji || m.title.native || `#${m.id}`,
    romaji: opt(m.title.romaji),
    native: opt(m.title.native),
    cover: opt(m.coverImage?.large),
    color: opt(m.coverImage?.color),
    score: opt(m.averageScore),
    popularity: opt(m.popularity),
    genres: m.genres ?? [],
    year: opt(m.seasonYear) ?? opt(m.startDate?.year),
    format: opt(m.format),
    episodes: opt(m.episodes),
    chapters: opt(m.chapters),
  };
}

type Page = { Page: { media: RawMedia[]; pageInfo?: { hasNextPage: boolean } } };

export async function searchMedia(q: string, type: MediaKind): Promise<Media[]> {
  const r = await gql<Page>('', `query ($q: String, $t: MediaType) { Page(perPage: 15) { media(search: $q, type: $t, isAdult: false, sort: SEARCH_MATCH) { ${FIELDS} } } }`, { q, t: type });
  return r.Page.media.map(toMedia);
}

export type Chart = 'top' | 'trending' | 'now';
/** Light novels count as manga on AniList but are not read in the manga reader; music videos are no anime to watch. */
export const NOT_SHOWN: Record<MediaKind, string[]> = { ANIME: ['MUSIC'], MANGA: ['NOVEL'] };
const CHART_SORT: Record<Chart, string> = { top: 'SCORE_DESC', trending: 'TRENDING_DESC', now: 'POPULARITY_DESC' };

/**
 * The best known titles: of all time (with enough votes that the score means something), trending now, or airing /
 * coming out now. Japanese titles only: Korean and Chinese comics are not Japanese to read. No light novels or music videos.
 */
export async function chartMedia(chart: Chart, type: MediaKind, page: number, genre?: string): Promise<{ media: Media[]; more: boolean }> {
  const r = await gql<Page>(
    '',
    `query ($t: MediaType, $p: Int, $g: String, $s: [MediaSort], $st: MediaStatus, $pop: Int, $not: [MediaFormat]) { Page(page: $p, perPage: 30) { pageInfo { hasNextPage } media(type: $t, genre: $g, sort: $s, status: $st, popularity_greater: $pop, format_not_in: $not, isAdult: false, countryOfOrigin: "JP") { ${FIELDS} } } }`,
    { t: type, p: page, g: genre || undefined, s: [CHART_SORT[chart]], st: chart === 'now' ? 'RELEASING' : undefined, pop: chart === 'top' ? 5000 : undefined, not: NOT_SHOWN[type] },
  );
  return { media: r.Page.media.map(toMedia), more: Boolean(r.Page.pageInfo?.hasNextPage) };
}

/** AniList's community recommendations for each of `ids` (at most 10 per call), and the titles themselves. */
export async function recommendationsFor(ids: number[]): Promise<{ seeds: Media[]; edges: RecEdge[] }> {
  type Node = { rating: number | null; mediaRecommendation: (RawMedia & { isAdult?: boolean | null }) | null };
  type R = { Page: { media: (RawMedia & { recommendations: { nodes: Node[] } })[] } };
  const r = await gql<R>(
    '',
    `query ($ids: [Int]) { Page(perPage: 10) { media(id_in: $ids) { ${FIELDS} recommendations(perPage: 12, sort: [RATING_DESC]) { nodes { rating mediaRecommendation { ${FIELDS} isAdult } } } } } }`,
    { ids: ids.slice(0, 10) },
  );
  const edges: RecEdge[] = [];
  for (const m of r.Page.media)
    for (const n of m.recommendations.nodes) {
      const rec = n.mediaRecommendation;
      if (rec && !rec.isAdult) edges.push({ seed: m.id, rating: n.rating ?? 0, media: toMedia(rec) });
    }
  return { seeds: r.Page.media.map(toMedia), edges };
}

/** The best AniList match for each title (undefined when there is none). One call for up to 10 titles. */
export async function matchTitles(titles: string[], type: MediaKind): Promise<(Media | undefined)[]> {
  const list = titles.slice(0, 10);
  if (!list.length) return [];
  const vars = list.map((_, i) => `$s${i}: String`).join(', ');
  const parts = list.map((_, i) => `m${i}: Page(perPage: 1) { media(search: $s${i}, type: ${type}, sort: SEARCH_MATCH) { ${FIELDS} } }`).join(' ');
  const r = await gql<Record<string, { media: RawMedia[] }>>('', `query (${vars}) { ${parts} }`, Object.fromEntries(list.map((t, i) => [`s${i}`, t])));
  return list.map((_, i) => {
    const m = r[`m${i}`]?.media[0];
    return m ? toMedia(m) : undefined;
  });
}

export type MediaDetail = Media & { description?: string; url?: string };

export async function mediaDetail(id: number): Promise<MediaDetail> {
  const r = await gql<{ Media: RawMedia & { description: string | null; siteUrl: string | null } }>('', `query ($id: Int) { Media(id: $id) { ${FIELDS} description(asHtml: false) siteUrl } }`, { id });
  const description = r.Media.description
    ?.replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { ...toMedia(r.Media), description: description || undefined, url: r.Media.siteUrl ?? undefined };
}

let viewer: { token: string; id: number } | undefined;

/** Everything on the user's AniList lists (anime and manga, every status). */
export async function listEntries(token: string): Promise<ListEntry[]> {
  if (viewer?.token !== token) viewer = { token, id: (await gql<{ Viewer: { id: number } }>(token, 'query { Viewer { id } }', {})).Viewer.id };
  type Entry = { id: number; status: string; updatedAt: number | null; score: number | null; progress: number | null; media: RawMedia };
  type Coll = { lists: { entries: Entry[] }[] } | null;
  const part = (type: MediaKind) =>
    `${type.toLowerCase()}: MediaListCollection(userId: $u, type: ${type}) { lists { entries { id status updatedAt score(format: POINT_100) progress media { ${FIELDS} } } } }`;
  const r = await gql<{ anime: Coll; manga: Coll }>(token, `query ($u: Int) { ${part('ANIME')} ${part('MANGA')} }`, { u: viewer.id });
  // A title in a custom list shows up twice: once is enough.
  const out = new Map<number, ListEntry>();
  for (const coll of [r.anime, r.manga])
    for (const l of coll?.lists ?? [])
      for (const e of l.entries) out.set(e.id, { entryId: e.id, status: e.status, updatedAt: e.updatedAt ?? 0, score: e.score ?? 0, progress: e.progress ?? 0, media: toMedia(e.media) });
  return [...out.values()];
}

/** Puts a title on the AniList list as Planning; returns the list entry id. */
export async function savePlanning(token: string, mediaId: number): Promise<number> {
  const r = await gql<{ SaveMediaListEntry: { id: number } }>(token, 'mutation ($id: Int) { SaveMediaListEntry(mediaId: $id, status: PLANNING) { id } }', { id: mediaId });
  return r.SaveMediaListEntry.id;
}

export async function deleteListEntry(token: string, entryId: number): Promise<void> {
  await gql(token, 'mutation ($id: Int) { DeleteMediaListEntry(id: $id) { deleted } }', { id: entryId });
}
