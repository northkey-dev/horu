import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import { SUBS_DIR, writeJsonAtomic } from './config.ts';
import { addPreviewCards, type PreviewCard } from './preview.ts';
import { downloadCues, listFiles } from './jimaku.ts';
import { importWords, knownSet, knownSummary, primingFor, refreshFromAnki, refreshServices, setKnown, setStatus, wordState } from './knownWords.ts';
import { jpdbKnown, wanikaniKnown } from '../../shared/knownSources.ts';
import { parseWordList, type WordStatus } from '../../shared/words.ts';
import { getSettings, updateSettings } from './config.ts';
import { allChapters, listManga } from './manga/library.ts';
import { log } from './log.ts';
import * as store from './store.ts';
import type { Cue } from '../../shared/types.ts';

// V3: known words, episode difficulty + priming, statistics.

const h =
  (fn: (req: Request) => unknown) =>
  async (req: Request, res: Response): Promise<void> => {
    try {
      res.json((await fn(req)) ?? { ok: true });
    } catch (err) {
      log.warn(`insights ${req.path}:`, (err as Error).message);
      res.status(400).json({ error: (err as Error).message });
    }
  };

/** Subtitles of any episode (from a past session or downloaded from Jimaku, cached). */
async function episodeCues(entryId: number, episode: number): Promise<Cue[]> {
  const session = store.allSessions().find((s) => s.jimakuEntryId === entryId && s.episode === episode && s.cueCount > 0);
  if (session) return store.sessionCues(session.id);
  const file = path.join(SUBS_DIR, `jimaku-${entryId}-${episode}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const [first] = await listFiles(entryId, episode);
  if (!first) throw new Error('No Japanese subtitles for this episode on Jimaku.');
  const { cues } = await downloadCues(first, episode);
  writeJsonAtomic(file, cues);
  return cues;
}

const dayKey = (iso: string) => iso.slice(0, 10);

export function insightsRouter(): express.Router {
  const r = express.Router();
  r.use(express.json());

  r.get(
    '/known',
    h(async (req) => {
      if (req.query.refresh) {
        await refreshFromAnki(true);
        await refreshServices(true).catch((e: Error) => log.warn('Known-word services:', e.message));
      }
      const total = (await knownSet()).size;
      return { ...knownSummary(), total };
    }),
  );
  r.post(
    '/known',
    h((req) => {
      const { word, known } = req.body as { word: string; known: boolean };
      if (!word?.trim()) throw new Error('word missing');
      setKnown(word.trim(), Boolean(known));
      return { ok: true };
    }),
  );
  r.post(
    '/status',
    h((req) => {
      const { word, status } = req.body as { word: string; status: WordStatus | null };
      if (!word?.trim()) throw new Error('word missing');
      if (status !== null && ![-1, 0, 1, 2, 3, 4].includes(status)) throw new Error('bad status');
      setStatus(word.trim(), status);
      return { ok: true };
    }),
  );
  /** All known words and statuses at once, for the phone's own copy. */
  r.get('/words', h(() => wordState()));
  /** Known words from jpdb.io / WaniKani (key in the body or from Settings) or a pasted word list. */
  r.post(
    '/known/import',
    h(async (req) => {
      const { source, key, text } = req.body as { source: 'jpdb' | 'wanikani' | 'list'; key?: string; text?: string };
      const s = getSettings();
      let words: string[];
      if (source === 'list') words = parseWordList(text ?? '');
      else if (source === 'wanikani') words = await wanikaniKnown(key || s.wanikaniToken);
      else if (source === 'jpdb') words = await jpdbKnown(key || s.jpdbApiKey);
      else throw new Error('Unknown source');
      if (!words.length) throw new Error('No Japanese words found');
      // Keep the key so the words stay up to date (refreshServices, every 12 h).
      if (key && source === 'wanikani') updateSettings({ wanikaniToken: key });
      if (key && source === 'jpdb') updateSettings({ jpdbApiKey: key });
      return { count: importWords(source, words) };
    }),
  );
  r.post(
    '/known/check',
    h(async (req) => {
      const known = await knownSet();
      return Object.fromEntries(((req.body?.words as string[]) ?? []).map((w) => [w, known.has(w)]));
    }),
  );

  /** Difficulty of an episode + the words worth learning before watching it. */
  r.get(
    '/episode',
    h(async (req) => {
      await refreshFromAnki().catch(() => 0);
      const cues = await episodeCues(Number(req.query.entryId), Number(req.query.episode));
      return primingFor(cues.map((c) => c.text), Number(req.query.limit ?? 12));
    }),
  );

  /** One-tap cards for words from the pre-watch / pre-read list (skips words that already have a card). */
  r.post(
    '/preview-cards',
    h((req) => addPreviewCards((req.body?.cards ?? []) as PreviewCard[])),
  );


  r.get(
    '/stats',
    h(async () => {
      const moments = store.listMoments();
      const done = moments.filter((m) => m.status === 'done');
      const today = new Date();
      const days: { day: string; marked: number; cards: number }[] = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date(today.getTime() - i * 86400_000).toISOString().slice(0, 10);
        days.push({
          day: d,
          marked: moments.filter((m) => dayKey(m.createdAt) === d).length,
          cards: done.filter((m) => dayKey(m.createdAt) === d).length,
        });
      }
      // Streak: consecutive days (ending today or yesterday) with at least one card.
      const cardDays = new Set(done.map((m) => dayKey(m.createdAt)));
      let streak = 0;
      for (let i = cardDays.has(dayKey(today.toISOString())) ? 0 : 1; ; i++) {
        if (cardDays.has(new Date(today.getTime() - i * 86400_000).toISOString().slice(0, 10))) streak++;
        else break;
      }
      const byTitle = new Map<string, { title: string; kind: string; cards: number; marked: number }>();
      for (const m of moments) {
        const key = `${m.kind}:${m.title}`;
        const row = byTitle.get(key) ?? { title: m.title, kind: m.kind, cards: 0, marked: 0 };
        row.marked++;
        if (m.status === 'done') row.cards++;
        byTitle.set(key, row);
      }
      return {
        totalCards: done.length,
        totalMarked: moments.length,
        inbox: store.inboxMoments().length,
        streak,
        episodes: store.allSessions().length,
        chaptersRead: allChapters().filter((c) => c.readAt).length,
        mangaReading: listManga().filter((m) => m.status === 'reading').length,
        knownWords: (await knownSet()).size,
        days,
        titles: [...byTitle.values()].sort((a, b) => b.cards - a.cards || b.marked - a.marked).slice(0, 10),
      };
    }),
  );

  return r;
}
