import type { MediaKind } from './watchlist.ts';

// Kitsu (kitsu.app) finds titles from the first letters ("frier" → Frieren), which AniList's search does not. The
// List tab asks it while you type and keeps only titles Kitsu links to AniList: everything else in Horu speaks
// AniList ids. No key; browsers may call it directly.

const BASE = 'https://kitsu.app/api/edge';

type Resource = { id: string; attributes: Record<string, string>; relationships?: { mappings?: { data: { id: string }[] } } };

/** AniList ids of the titles Kitsu finds for `q`, best match first. */
export async function kitsuAnilistIds(q: string, type: MediaKind, limit = 8): Promise<number[]> {
  const kind = type === 'ANIME' ? 'anime' : 'manga';
  const url =
    `${BASE}/${kind}?filter%5Btext%5D=${encodeURIComponent(q)}&page%5Blimit%5D=${Math.min(20, limit)}` +
    `&include=mappings&fields%5B${kind}%5D=mappings&fields%5Bmappings%5D=externalSite,externalId`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Kitsu: HTTP ${res.status}`);
  const j = (await res.json()) as { data: Resource[]; included?: Resource[] };
  const mappings = new Map((j.included ?? []).map((m) => [m.id, m.attributes]));
  const ids: number[] = [];
  for (const item of j.data) {
    const link = (item.relationships?.mappings?.data ?? []).map((r) => mappings.get(r.id)).find((m) => m?.externalSite === `anilist/${kind}`);
    const id = Number(link?.externalId);
    if (Number.isInteger(id) && id > 0 && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
