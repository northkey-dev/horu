import { chapterNumbers, sameChapter } from '../../../shared/chapterMatch.ts';
import * as lib from './library.ts';
import { readingOrder, scheduleSync } from './prepare.ts';
import * as suwa from './suwayomi.ts';

// Carrying on a manga you read elsewhere: your place is set to a chapter number, so Horu prepares from there.
// The chapters before it count as read in the source (Suwayomi), not in Horu's stats: XP and streaks are for what
// you read in Horu.

/** A source chapter's number: the source's own, else the one in its name. */
const numberOf = (c: suwa.Chapter): number | undefined => (c.chapterNumber >= 0 ? c.chapterNumber : chapterNumbers(c.name).chapter);

function checkNumber(n: number): void {
  if (!Number.isFinite(n) || n < 0) throw new Error('Type the number of a chapter.');
}

/** The chapter with number `n` in a source's reading order, and the chapters before it. */
export async function sourceChapterAt(mangaId: number, n: number): Promise<{ chapter: suwa.Chapter; before: suwa.Chapter[] }> {
  checkNumber(n);
  const { chapters } = await suwa.mangaWithChapters(mangaId, false);
  const sorted = readingOrder(chapters);
  const i = sorted.findIndex((c) => numberOf(c) === n);
  if (i < 0) {
    const last = sorted.at(-1);
    throw new Error(`There is no chapter ${n} in this source${last ? ` (the latest is ${numberOf(last) ?? last.name})` : ''}.`);
  }
  return { chapter: sorted[i], before: sorted.slice(0, i) };
}

/** The chapters you skipped count as read in the source, so its list shows the right place. */
export async function markSkipped(before: suwa.Chapter[]): Promise<void> {
  await suwa.markChaptersRead(before.filter((c) => !c.isRead).map((c) => c.id)).catch(() => undefined);
}

/** Sets your place in a manga of the library to chapter `n` (page 1); the reading window moves there. */
export async function setPlace(mangaKey: string, n: number): Promise<lib.ActiveManga> {
  const manga = lib.getManga(mangaKey);
  if (!manga) throw new Error('Unknown manga');
  checkNumber(n);
  let chapterKey: string;
  if (mangaKey.startsWith('s')) {
    const { chapter, before } = await sourceChapterAt(Number(mangaKey.slice(1)), n);
    chapterKey = `c${chapter.id}`;
    await markSkipped(before);
  } else {
    // Imported files: a chapter with that number, or a whole volume with it
    const hit = lib.chaptersOf(mangaKey).find((c) => {
      const no = chapterNumbers(c.name);
      return sameChapter(no, { chapter: n }) || (no.chapter === undefined && no.volume === n);
    });
    if (!hit) throw new Error(`There is no chapter or volume ${n} among the imported ones.`);
    chapterKey = hit.key;
  }
  lib.updateManga(mangaKey, { chapterKey, page: 0, lastReadAt: new Date().toISOString() });
  scheduleSync(100);
  return lib.getManga(mangaKey)!;
}
