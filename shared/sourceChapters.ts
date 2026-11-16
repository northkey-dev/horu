// The chapter list a manga source gives, made readable. Some sources list a chapter twice, an official
// translation and a fan one (MangaFire marks the official one with a tick: scanlator "official"), and some add
// whole volumes as one big chapter "Ch. 0 - Volume 8" with the pages of all its chapters. Horu keeps one entry
// per chapter number, the official one first, and lists whole volumes apart, so the reading window never takes
// a 200-page volume for chapter 0.

export type SourceChapter = { id: number; name: string; chapterNumber: number; sourceOrder: number; scanlator?: string | null; uploadDate?: string | number | null };

const official = (c: SourceChapter) => /\bofficial\b/i.test(c.scanlator ?? '');

/** A whole volume posted as one chapter: no chapter number of its own, "Volume 8" / "Vol. 8" in the name. */
export const isVolumeBundle = (c: SourceChapter): boolean => c.chapterNumber <= 0 && /\bvol(?:ume)?\.?\s*\d+/i.test(c.name);

/** Of two entries for the same chapter: the official one, else the newer upload. */
const better = (a: SourceChapter, b: SourceChapter) => (official(a) !== official(b) ? official(a) : Number(a.uploadDate ?? 0) > Number(b.uploadDate ?? 0));

/** One entry per chapter number (unknown numbers, below 0, all stay), in the source's order; whole volumes apart. */
export function pickChapters<T extends SourceChapter>(list: T[]): { chapters: T[]; volumes: T[] } {
  const best = new Map<number, T>();
  for (const c of list) {
    if (isVolumeBundle(c) || c.chapterNumber < 0) continue;
    const had = best.get(c.chapterNumber);
    if (!had || better(c, had)) best.set(c.chapterNumber, c);
  }
  const keep = new Set(best.values());
  return {
    chapters: list.filter((c) => !isVolumeBundle(c) && (c.chapterNumber < 0 || keep.has(c))),
    volumes: list.filter(isVolumeBundle),
  };
}

/**
 * The entry that took the place of a chapter left out as a duplicate (your place was in the fan translation, the
 * official one is kept): the kept chapter with the same number.
 */
export function keptFor<T extends SourceChapter>(all: T[], kept: T[], id: number): T | undefined {
  const was = all.find((c) => c.id === id);
  if (!was) return undefined;
  if (kept.includes(was)) return was;
  return was.chapterNumber >= 0 ? kept.find((c) => c.chapterNumber === was.chapterNumber) : undefined;
}
