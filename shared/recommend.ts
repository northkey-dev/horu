import type { ListEntry, Media } from './watchlist.ts';

// Recommendations "for you": every title you watched, read, rated or put on your list is a seed. AniList's
// community recommendations of each seed are summed up, weighted by how much the seed counts, and tilted by the
// title's average score and by how well its genres match what you watch.

export type SeedWhy = 'watched' | 'read' | 'rated' | 'listed';
export type Seed = { id: number; title: string; weight: number; why: SeedWhy };
/** "Users who liked `seed` recommend `media`", with the number of votes */
export type RecEdge = { seed: number; rating: number; media: Media };
export type Recommendation = { media: Media; score: number; because: { title: string; why: SeedWhy }[] };

/** How much an AniList list entry says about your taste; 0 = not a seed (disliked, dropped, planned). */
export function entryWeight(e: Pick<ListEntry, 'status' | 'score'>): number {
  if (!['COMPLETED', 'CURRENT', 'REPEATING', 'PAUSED'].includes(e.status)) return 0;
  if (e.score > 0) return e.score < 55 ? 0 : 0.5 + (e.score - 55) / 30;
  return e.status === 'PAUSED' ? 0.5 : e.status === 'CURRENT' ? 0.9 : 1;
}

/** Hours of an anime watched in Horu → seed weight (an episode counts a bit, a whole season a lot). */
export const watchedWeight = (seconds: number): number => 0.8 + Math.min(1.2, seconds / 3600 / 4);

/** One seed per title, the strongest reason kept. */
export function mergeSeeds(seeds: Seed[], max = 40): Seed[] {
  const byId = new Map<number, Seed>();
  for (const s of seeds) {
    const had = byId.get(s.id);
    if (!had || s.weight > had.weight) byId.set(s.id, s);
  }
  return [...byId.values()].sort((a, b) => b.weight - a.weight).slice(0, max);
}

/** Genre → share of your taste (0-1), from the seeds' genres. */
export function genreProfile(seeds: { weight: number; genres: string[] }[]): Record<string, number> {
  const sum: Record<string, number> = {};
  for (const s of seeds) for (const g of s.genres) sum[g] = (sum[g] ?? 0) + s.weight;
  const top = Math.max(0, ...Object.values(sum));
  return top ? Object.fromEntries(Object.entries(sum).map(([g, v]) => [g, v / top])) : {};
}

export const topGenres = (profile: Record<string, number>, n: number): string[] =>
  Object.entries(profile)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([g]) => g);

export function rankRecommendations(seeds: Seed[], edges: RecEdge[], exclude: Set<number>, profile: Record<string, number>): Recommendation[] {
  const seedById = new Map(seeds.map((s) => [s.id, s]));
  const best = new Map<number, number>();
  for (const e of edges) best.set(e.seed, Math.max(best.get(e.seed) ?? 1, e.rating));

  const acc = new Map<number, { media: Media; sum: number; from: Map<number, number> }>();
  for (const e of edges) {
    const seed = seedById.get(e.seed);
    if (!seed || e.rating <= 0 || exclude.has(e.media.id) || seedById.has(e.media.id)) continue;
    const part = seed.weight * (0.35 + (0.65 * e.rating) / best.get(e.seed)!);
    const c = acc.get(e.media.id) ?? { media: e.media, sum: 0, from: new Map() };
    c.sum += part;
    c.from.set(seed.id, (c.from.get(seed.id) ?? 0) + part);
    acc.set(e.media.id, c);
  }

  return [...acc.values()]
    .map((c) => {
      const quality = (c.media.score ?? 65) / 100;
      const genres = c.media.genres;
      const affinity = genres.length ? genres.reduce((a, g) => a + (profile[g] ?? 0), 0) / genres.length : 0;
      const because = [...c.from]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([id]) => seedById.get(id)!)
        .map((s) => ({ title: s.title, why: s.why }));
      return { media: c.media, score: c.sum * (0.5 + quality) * (0.8 + 0.4 * affinity), because };
    })
    .sort((a, b) => b.score - a.score);
}
