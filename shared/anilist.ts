// AniList: ticks off watched episodes in the user's list. Works from the laptop and from the phone (AniList
// allows browser calls). The token comes from AniList's implicit login with a client id of the user's own
// (anilist.co/settings/developer, redirect URL = the app's address), or is pasted.

const URL = 'https://graphql.anilist.co';

export const anilistLoginUrl = (clientId: string) => `https://anilist.co/api/v2/oauth/authorize?client_id=${encodeURIComponent(clientId)}&response_type=token`;

async function gql<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token.trim()}` },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message: string }[] };
  if (!res.ok || data.errors?.length) throw new Error(`AniList: ${data.errors?.[0]?.message ?? `HTTP ${res.status}`}`);
  return data.data as T;
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
