import { matchTitles } from '../../../shared/anilist.ts';
import { chapterNumbers, cleanTitle, sameChapter } from '../../../shared/chapterMatch.ts';
import { log } from '../log.ts';
import * as lib from './library.ts';
import { enqueue, sortChapters } from './prepare.ts';
import * as suwa from './suwayomi.ts';

// The Japanese and the English edition of the same manga, side by side: the reader shows the English page of a
// Japanese chapter to look something up. Editions pair by themselves when AniList knows both titles as the same
// manga; a pair set by hand (on either edition) wins.

const langOf = (m: lib.ActiveManga): lib.MangaLang => m.lang ?? 'ja';

/** The other edition of a manga, if there is one in the library. */
export function pairOf(m: lib.ActiveManga): lib.ActiveManga | undefined {
  if (m.pairWith !== undefined) return m.pairWith ? lib.getManga(m.pairWith) : undefined; // '' = none, by hand
  if (!m.anilistId) return undefined;
  return lib.listManga().find((o) => langOf(o) !== langOf(m) && o.anilistId === m.anilistId && o.pairWith === undefined);
}

/** Pairs two editions by hand (`other` undefined: no pair). Both sides know it, an old partner is let go. */
export function setPair(key: string, other: string | undefined): void {
  const m = lib.getManga(key);
  if (!m) throw new Error('Unknown manga');
  const o = other ? lib.getManga(other) : undefined;
  if (other && (!o || langOf(o) === langOf(m))) throw new Error('Pair it with a manga of the other language.');
  for (const old of [pairOf(m), o && pairOf(o)]) if (old && old.key !== other && old.key !== key) lib.updateManga(old.key, { pairWith: '' });
  lib.updateManga(key, { pairWith: other ?? '' });
  if (o) lib.updateManga(o.key, { pairWith: key });
}

let resolving = false;

/**
 * Looks up the AniList id of every manga that has none yet, so the editions can pair. Only once there is an
 * English manga: until then nothing is sent to AniList for this.
 */
export async function resolveAnilistIds(): Promise<void> {
  if (resolving || !lib.listManga().some((m) => m.lang === 'en')) return;
  resolving = true;
  try {
    const todo = lib.listManga().filter((m) => m.anilistId === undefined);
    for (let i = 0; i < todo.length; i += 10) {
      const part = todo.slice(i, i + 10);
      const found = await matchTitles(
        part.map((m) => cleanTitle(m.title)),
        'MANGA',
      );
      part.forEach((m, j) => lib.updateManga(m.key, { anilistId: found[j]?.id ?? 0 }));
    }
  } catch (err) {
    log.warn('AniList lookup of manga titles failed', (err as Error).message);
  } finally {
    resolving = false;
  }
}

export type PairChapter = { manga?: { key: string; title: string }; chapter?: lib.PreparedChapter; missing?: boolean };

/**
 * The chapter of the other edition that matches this one, by its number. Not prepared yet: from an online source
 * it is fetched now (first in line); one that was stopped or failed is started again.
 */
export async function pairChapter(chapterKey: string): Promise<PairChapter> {
  const c = lib.getChapter(chapterKey);
  const m = c && lib.getManga(c.mangaKey);
  const p = m && pairOf(m);
  if (!c || !p) return {};
  const manga = { key: p.key, title: p.title };
  const want = chapterNumbers(c.name);

  const have = lib.chaptersOf(p.key).find((x) => sameChapter(want, chapterNumbers(x.name)));
  if (have) {
    if (['error', 'paused', 'cancelled'].includes(have.status)) {
      lib.updateChapter(have.key, { status: 'queued', error: undefined });
      enqueue(have.key, true);
    }
    return { manga, chapter: lib.getChapter(have.key) };
  }

  if (!p.key.startsWith('s')) return { manga, missing: true };
  const { chapters } = await suwa.mangaWithChapters(Number(p.key.slice(1)), false);
  const sorted = sortChapters(chapters);
  const hit = sorted.find((rc) => sameChapter(want, rc.chapterNumber > 0 ? { chapter: rc.chapterNumber } : chapterNumbers(rc.name)));
  if (!hit) return { manga, missing: true };
  const key = `c${hit.id}`;
  lib.upsertChapter({ key, mangaKey: p.key, name: hit.name, order: sorted.indexOf(hit), status: 'queued', pageCount: hit.pageCount, pagesDone: 0, compare: true });
  enqueue(key, true);
  return { manga, chapter: lib.getChapter(key) };
}
