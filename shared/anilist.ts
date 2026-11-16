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

/** Titles matching `q` in any of their names (English, romaji, Japanese, other names), best match first. */
export async function searchMedia(q: string, type: MediaKind, count = 15): Promise<Media[]> {
  const r = await gql<Page>('', `query ($q: String, $t: MediaType, $n: Int) { Page(perPage: $n) { media(search: $q, type: $t, isAdult: false, sort: SEARCH_MATCH) { ${FIELDS} } } }`, { q, t: type, n: count });
  return r.Page.media.map(toMedia);
}

/** These titles, in this order (unknown or adult ones left out). Up to 25 in one call. */
export async function mediaByIds(ids: number[]): Promise<Media[]> {
  if (!ids.length) return [];
  const r = await gql<Page>('', `query ($ids: [Int]) { Page(perPage: 25) { media(id_in: $ids, isAdult: false) { ${FIELDS} } } }`, { ids: ids.slice(0, 25) });
  const byId = new Map(r.Page.media.map((m) => [m.id, toMedia(m)]));
  return ids.map((id) => byId.get(id)).filter((m): m is Media => Boolean(m));
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

/** Who made it: the mangaka (story, art) or the original creator, with the Japanese name when AniList has it. */
export type Creator = { name: string; native?: string; roles: string[] };
/**
 * `status`: AniList's FINISHED, RELEASING, NOT_YET_RELEASED, CANCELLED or HIATUS. `aired`: episodes out so far while
 * an anime airs (AniList knows the next one). `volumes`: manga volumes once AniList counts them.
 */
export type MediaDetail = Media & { description?: string; url?: string; creators: Creator[]; status?: string; aired?: number; volumes?: number };

const STATUS: Record<string, string> = { FINISHED: 'Finished', RELEASING: 'Ongoing', NOT_YET_RELEASED: 'Not out yet', CANCELLED: 'Cancelled', HIATUS: 'On hiatus' };
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * How far a title is: "Finished · 24 episodes", "Ongoing · 11 of 24 episodes out", "Ongoing · 1 volume so far". AniList
 * leaves the chapter count of a running manga open, so there is none then.
 */
export function releaseLine(d: Pick<MediaDetail, 'type' | 'status' | 'episodes' | 'chapters' | 'aired' | 'volumes' | 'format'>): { status?: string; count?: string } {
  const status = d.status ? STATUS[d.status] : undefined;
  const running = d.status === 'RELEASING' || d.status === 'HIATUS';
  let count: string | undefined;
  if (d.format === 'MOVIE') count = undefined; // a film is one piece, not "1 episode"
  else if (d.type === 'ANIME') {
    if (running && d.aired !== undefined) count = d.episodes ? `${d.aired} of ${plural(d.episodes, 'episode')} out` : `${plural(d.aired, 'episode')} out so far`;
    else if (d.episodes) count = d.status === 'NOT_YET_RELEASED' ? `${plural(d.episodes, 'episode')} planned` : plural(d.episodes, 'episode');
  } else {
    const parts = [d.chapters && plural(d.chapters, 'chapter'), d.volumes && plural(d.volumes, 'volume')].filter(Boolean);
    if (parts.length) count = parts.join(' · ') + (running ? ' so far' : '');
    else if (running) count = 'chapter count still open';
  }
  return { status, count };
}

const CREATOR_ROLES = new Set(['Story & Art', 'Story', 'Art', 'Original Creator', 'Original Story']);

type StaffEdge = { role: string | null; node: { name: { full: string | null; native: string | null } } | null };

/** The people behind a title from its staff list; assistants, translators and editors stay out. */
export function creatorsOf(edges: StaffEdge[]): Creator[] {
  const byName = new Map<string, Creator>();
  for (const e of edges) {
    const role = (e.role ?? '').replace(/\s*\(.*\)\s*$/, '').trim();
    const name = e.node?.name.full?.trim();
    if (!name || !CREATOR_ROLES.has(role)) continue;
    const had = byName.get(name) ?? { name, native: e.node?.name.native?.trim() || undefined, roles: [] };
    if (!had.roles.includes(role)) had.roles.push(role);
    byName.set(name, had);
  }
  return [...byName.values()].slice(0, 4);
}

export async function mediaDetail(id: number): Promise<MediaDetail> {
  type R = RawMedia & {
    description: string | null;
    siteUrl: string | null;
    status: string | null;
    volumes: number | null;
    nextAiringEpisode: { episode: number } | null;
    staff: { edges: StaffEdge[] } | null;
  };
  const r = await gql<{ Media: R }>(
    '',
    `query ($id: Int) { Media(id: $id) { ${FIELDS} description(asHtml: false) siteUrl status volumes nextAiringEpisode { episode } staff(sort: [RELEVANCE, ROLE], perPage: 12) { edges { role node { name { full native } } } } } }`,
    { id },
  );
  const description = r.Media.description
    ?.replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const next = r.Media.nextAiringEpisode?.episode;
  return {
    ...toMedia(r.Media),
    description: description || undefined,
    url: r.Media.siteUrl ?? undefined,
    creators: creatorsOf(r.Media.staff?.edges ?? []),
    status: opt(r.Media.status),
    aired: next ? next - 1 : undefined,
    volumes: opt(r.Media.volumes),
  };
}

// ---------------------------------------------------------------- seasons

/** One part of a series (a season, film, special) with how far it is and when it started (`start`: "2023-07-06", for order). */
export type Part = Media & { status?: string; aired?: number; start?: string };

const PART_FIELDS = `${FIELDS} status startDate { year month day } nextAiringEpisode { episode }`;
type RawPart = RawMedia & { status: string | null; startDate?: { year?: number | null; month?: number | null; day?: number | null } | null; nextAiringEpisode: { episode: number } | null };

function toPart(r: RawPart): Part {
  const d = r.startDate;
  const pad = (n?: number | null) => String(n ?? 0).padStart(2, '0');
  const next = r.nextAiringEpisode?.episode;
  return { ...toMedia(r), status: opt(r.status), aired: next ? next - 1 : undefined, start: d?.year ? `${d.year}-${pad(d.month)}-${pad(d.day)}` : undefined };
}

/** Parts without a start date (announced, no date yet) go last; otherwise by start date. */
export const orderParts = (parts: Part[]): Part[] => [...parts].sort((a, b) => (a.start ?? '9999').localeCompare(b.start ?? '9999') || a.id - b.id);

/** A title of the other kind the series comes from or was made into (the manga of an anime, the anime of a manga). */
export type Linked = Part & { fromOpen: boolean };

/**
 * The one counterpart to offer: links of the open title first, then the main format (the manga itself, the first TV
 * season) before one-shots, films and specials, then the oldest. Light novels and music videos are left out.
 */
export function pickLinked(cands: Linked[]): Part | undefined {
  const main = (p: Part) => (p.format === 'MANGA' || p.format === 'TV' ? 0 : p.format === 'TV_SHORT' || p.format === 'ONA' ? 1 : 2);
  const ok = cands.filter((c) => c.format !== 'NOVEL' && c.format !== 'MUSIC');
  ok.sort((a, b) => Number(b.fromOpen) - Number(a.fromOpen) || main(a) - main(b) || (a.start ?? '9999').localeCompare(b.start ?? '9999'));
  if (!ok[0]) return undefined;
  const { fromOpen: _, ...part } = ok[0];
  return part;
}

export type Series = { parts: Part[]; linked?: Part };

/**
 * Every part of the series a title belongs to: AniList keeps each season as its own title, linked as prequel and
 * sequel. Walks those links both ways (one call per step, at most 8 steps and 30 parts), oldest first. On the way
 * it collects the source and adaptations of the other kind (`linked`: the manga of an anime and the other way round).
 */
export async function seriesParts(id: number): Promise<Series> {
  type Edge = { relationType: string; node: RawPart | null };
  type R = { Page: { media: (RawPart & { relations: { edges: Edge[] } | null })[] } };
  const found = new Map<number, Part>();
  const other = new Map<number, Linked>();
  let type: MediaKind | undefined;
  let frontier = [id];
  for (let step = 0; step < 8 && frontier.length && found.size < 30; step++) {
    const r = await gql<R>('', `query ($ids: [Int]) { Page(perPage: 25) { media(id_in: $ids) { ${PART_FIELDS} relations { edges { relationType node { ${PART_FIELDS} } } } } } }`, { ids: frontier.slice(0, 25) });
    const next: number[] = [];
    for (const m of r.Page.media) {
      type ??= m.type;
      found.set(m.id, toPart(m));
      for (const e of m.relations?.edges ?? []) {
        const n = e.node;
        if (!n) continue;
        if (n.type !== type) {
          if ((e.relationType === 'SOURCE' || e.relationType === 'ADAPTATION') && (!other.has(n.id) || m.id === id)) other.set(n.id, { ...toPart(n), fromOpen: m.id === id });
          continue;
        }
        if ((e.relationType !== 'PREQUEL' && e.relationType !== 'SEQUEL') || found.has(n.id) || next.includes(n.id)) continue;
        found.set(n.id, toPart(n));
        next.push(n.id);
      }
    }
    frontier = next;
  }
  return { parts: orderParts([...found.values()]).slice(0, 30), linked: pickLinked([...other.values()]) };
}

/** Parts that count as episodes of the series: TV seasons and web series; films, specials, OVAs and one-off web episodes are extra. */
const isSeason = (p: Part) => p.format === 'TV' || p.format === 'TV_SHORT' || (p.format === 'ONA' && (p.episodes ?? 0) > 1);

/**
 * What the whole series looks like from one of its parts: still going (a part airing or announced) and how many
 * episodes or chapters it has so far. `next`: the running or announced part, unless that is the one open.
 */
export function seriesSummary(parts: Part[], currentId: number): { next?: Part; nextState?: 'running' | 'announced'; total?: string } {
  const running = parts.find((p) => p.status === 'RELEASING');
  const announced = parts.find((p) => p.status === 'NOT_YET_RELEASED');
  const next = running ?? announced;
  const out: ReturnType<typeof seriesSummary> = next && next.id !== currentId ? { next, nextState: running ? 'running' : 'announced' } : {};
  const going = Boolean(next);
  if (parts[0]?.type === 'ANIME') {
    const series = parts.filter((p) => isSeason(p) && p.status !== 'NOT_YET_RELEASED');
    const n = series.reduce((a, p) => a + (p.status === 'RELEASING' ? (p.aired ?? 0) : (p.episodes ?? 0)), 0);
    if (series.length > 1 && n) out.total = `${n} episodes${going ? ' so far' : ' in all'}`;
  } else {
    const series = parts.filter((p) => p.format === 'MANGA');
    if (series.length > 1 && series.every((p) => p.chapters)) out.total = `${series.reduce((a, p) => a + p.chapters!, 0)} chapters in all`;
  }
  return out;
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

/** Puts a title on the AniList list as Planning (or Completed, for one marked seen); returns the list entry id. */
export async function saveStatus(token: string, mediaId: number, status: 'PLANNING' | 'COMPLETED'): Promise<number> {
  const r = await gql<{ SaveMediaListEntry: { id: number } }>(token, 'mutation ($id: Int, $s: MediaListStatus) { SaveMediaListEntry(mediaId: $id, status: $s) { id } }', { id: mediaId, s: status });
  return r.SaveMediaListEntry.id;
}

export async function deleteListEntry(token: string, entryId: number): Promise<void> {
  await gql(token, 'mutation ($id: Int) { DeleteMediaListEntry(id: $id) { deleted } }', { id: entryId });
}
