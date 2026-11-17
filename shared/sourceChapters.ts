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

/** "Ch. 4 - (1r0n)" → number part "Ch. 4" and title "(1r0n)". */
function splitName(name: string): { head: string; title: string } {
  const m = name.match(/^(.*?\d(?:\.\d+)?)\s*(?:[-–:]\s*(.*))?$/);
  return m ? { head: m[1], title: (m[2] ?? '').trim() } : { head: name, title: name };
}

/** No real chapter title: nothing, or only a tag in brackets (an uploader's name, "(1r0n)"). */
const noTitle = (title: string) => !title || /^[([][^)\]]*[)\]]$/.test(title);

/**
 * The kept entry with a real title: some uploaders put their name where the chapter title goes ("Ch. 4 - (1r0n)");
 * the left-out twin often has the title ("Ch. 4 - Sorcery and the Enchanted Blade").
 */
function titled<T extends SourceChapter>(kept: T, twins: T[]): T {
  const { head, title } = splitName(kept.name);
  if (!noTitle(title)) return kept;
  const better = twins.map((t) => splitName(t.name).title).find((t) => !noTitle(t));
  return better ? { ...kept, name: `${head} - ${better}` } : kept;
}

/** One entry per chapter number (unknown numbers, below 0, all stay), in the source's order; whole volumes apart. */
export function pickChapters<T extends SourceChapter>(list: T[]): { chapters: T[]; volumes: T[] } {
  const best = new Map<number, T>();
  for (const c of list) {
    if (isVolumeBundle(c) || c.chapterNumber < 0) continue;
    const had = best.get(c.chapterNumber);
    if (!had || better(c, had)) best.set(c.chapterNumber, c);
  }
  const chapters: T[] = [];
  for (const c of list) {
    if (isVolumeBundle(c)) continue;
    if (c.chapterNumber < 0) chapters.push(c);
    else if (best.get(c.chapterNumber) === c) chapters.push(titled(c, list.filter((t) => t !== c && t.chapterNumber === c.chapterNumber && !isVolumeBundle(t))));
  }
  return { chapters, volumes: list.filter(isVolumeBundle) };
}

/**
 * Chapters passed over: unread ones between the first chapter read and your place (`current`, an index in
 * `sorted`). An older Horu went on to the next prepared chapter, past ones that were not ready yet, and the reading
 * window only looks ahead of your place, so these were never prepared. A chapter counts as read when any entry with
 * its number is (in the source, or in Horu: `readHere`).
 */
export function passedOver<T extends SourceChapter & { isRead?: boolean }>(all: T[], sorted: T[], current: number, readHere: (c: T) => boolean): T[] {
  const read = (c: T) => all.some((t) => (t.id === c.id || (c.chapterNumber >= 0 && t.chapterNumber === c.chapterNumber && !isVolumeBundle(t))) && (t.isRead || readHere(t)));
  const first = sorted.findIndex(read);
  return first < 0 || first >= current ? [] : sorted.slice(first + 1, current).filter((c) => !read(c));
}

/**
 * The entry that took the place of a chapter left out as a duplicate (your place was in the fan translation, the
 * official one is kept): the kept chapter with the same number.
 */
export function keptFor<T extends SourceChapter>(all: T[], kept: T[], id: number): T | undefined {
  const was = all.find((c) => c.id === id);
  if (!was) return undefined;
  // Compared by id: a kept entry may be a copy with a better title.
  return kept.find((c) => c.id === id) ?? (was.chapterNumber >= 0 ? kept.find((c) => c.chapterNumber === was.chapterNumber) : undefined);
}
