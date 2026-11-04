import { getSettings } from './config.ts';
import { downloadCues, listFiles, searchEntries } from './jimaku.ts';
import { log } from './log.ts';
import * as store from './store.ts';
import { bestGuess, matchEntry, normalizeTitle, type EntryMatch, type PageText } from '../../shared/detect.ts';
import type { Cue, Session } from '../../shared/types.ts';

export type StartBody = {
  title: string;
  jimakuEntryId?: number;
  anilistId?: number;
  episode: number;
  fileUrl?: string;
  fileName?: string;
  /** Made by the page recognition */
  auto?: boolean;
  detected?: Session['detected'];
  /** Do not load Jimaku subtitles (the episode is not known) */
  noSubtitles?: boolean;
};

/** Starts an episode: loads the Jimaku subtitles (the first file unless one is given) and makes it the running one. */
export async function startSessionFor(body: StartBody): Promise<{ session: Session; warning?: string }> {
  if (!body.title || !Number.isFinite(body.episode)) throw new Error('Title and episode are required');
  let cues: Cue[] = [];
  let subtitleName: string | undefined;
  let warning: string | undefined;
  if (body.jimakuEntryId && !body.noSubtitles) {
    try {
      const file = body.fileUrl ? { url: body.fileUrl, name: body.fileName ?? 'subs.srt', size: 0 } : (await listFiles(body.jimakuEntryId, body.episode))[0];
      if (file) {
        ({ name: subtitleName, cues } = await downloadCues(file, body.episode));
      } else {
        warning = 'No Japanese subtitles on Jimaku for this episode. Whisper will transcribe instead.';
      }
    } catch (err) {
      warning = `Subtitles could not be loaded: ${(err as Error).message}`;
    }
  }
  const session = store.addSession(
    {
      id: store.newId(),
      createdAt: new Date().toISOString(),
      title: body.title,
      jimakuEntryId: body.jimakuEntryId,
      anilistId: body.anilistId,
      episode: body.episode,
      subtitleName,
      cueCount: cues.length,
      ...(body.auto ? { auto: true, detected: body.detected } : {}),
    },
    cues,
  );
  log.info(`Session: ${session.title} Ep ${session.episode} (${cues.length} lines)${session.auto ? ` [recognised, ${session.detected}]` : ''}`);
  return { session, warning };
}

// ---- recognising what a page shows (shared/detect.ts) ----

export type Detection = { status: 'none' | 'manual' | 'same' | 'updated' | 'started'; session?: Session; warning?: string };

/** Shorter searches for a title Jimaku does not know in full. */
const queriesFor = (title: string): string[] => {
  const words = title.split(/\s+/);
  return [...new Set([title, words.slice(0, 4).join(' '), words.slice(0, 2).join(' ')])].filter((q) => q.length >= 2);
};

async function findEntry(titles: string[], season?: number): Promise<EntryMatch | undefined> {
  if (!getSettings().jimakuApiKey) return undefined;
  let best: EntryMatch | undefined;
  for (const title of titles.slice(0, 3)) {
    for (const query of queriesFor(title)) {
      try {
        const match = matchEntry(title, await searchEntries(query), season);
        if (match && (!best || match.score > best.score)) best = match;
      } catch (err) {
        log.warn('Jimaku search failed', err);
        return best;
      }
      if (best?.confident) return best;
    }
  }
  return best;
}

const shownTitle = (e: EntryMatch['entry']) => e.english_name || e.name;
let running: Promise<Detection> | undefined;

/**
 * The texts of the recorded page name a show and an episode: start that episode, unless one was chosen by hand.
 * A recognised episode is replaced when the page moves on (next episode); the page's own subtitle lines stay.
 */
export function detectFromPage(texts: PageText[]): Promise<Detection> {
  running ??= detect(texts).finally(() => (running = undefined));
  return running;
}

async function detect(texts: PageText[]): Promise<Detection> {
  const guess = bestGuess(texts);
  if (!guess) return { status: 'none' };
  const active = store.activeSession();
  if (active && !active.auto) return { status: 'manual', session: active };

  const entry = await findEntry(guess.titles, guess.season);
  const title = entry ? shownTitle(entry.entry) : guess.titles[0];
  const episode = guess.episode ?? 1;
  const detected: Session['detected'] = entry ? (entry.confident ? 'matched' : 'unsure') : 'guess';

  if (active) {
    const sameShow = entry && active.jimakuEntryId ? active.jimakuEntryId === entry.entry.id : normalizeTitle(active.title) === normalizeTitle(title);
    if (sameShow && active.episode === episode) return { status: 'same', session: active };
    // A session the page's own subtitles made (named after the tab, episode 1): its lines belong to this page, so keep
    // them and fix what the session says about itself.
    if (active.subtitleName?.startsWith('From the page') && !active.detected) {
      const session = store.updateSession(active.id, { title, episode, jimakuEntryId: entry?.entry.id, anilistId: entry?.entry.anilist_id ?? undefined, detected });
      return { status: 'updated', session };
    }
  }
  const { session, warning } = await startSessionFor({
    title,
    jimakuEntryId: entry?.entry.id,
    anilistId: entry?.entry.anilist_id ?? undefined,
    episode,
    auto: true,
    detected,
    noSubtitles: guess.episode === undefined,
  });
  return { status: 'started', session, warning: guess.episode === undefined ? 'The page names no episode number, so no subtitles were loaded.' : warning };
}
