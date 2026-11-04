import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import { DATA_DIR, getSettings, writeJsonAtomic } from './config.ts';
import { ankiOnline, ensureAnki, invoke } from './anki.ts';
import { knownSet, knownSummary } from './knownWords.ts';
import { allChapters } from './manga/library.ts';
import { log } from './log.ts';
import { levelOf, READ_BLOCK_WORDS, streaks, watchBlocksByDay, WATCH_BLOCK_SECONDS, XP } from './xp.ts';
import { wordsReadByDay } from './text.ts';
import { preparedCount } from './preview.ts';
import * as store from './store.ts';
import type { Analytics, AnkiStats, DayStat, VocabPoint } from '../../shared/types.ts';

// Progress analytics: Horu activity (marks, cards, episodes, manga chapters) and, when Anki is reachable,
// the complete review history from its revlog. Both are merged per day into XP, streaks and levels.

const HISTORY_DAYS = 371; // 53 weeks, enough for a calendar heatmap
const DAY_SHIFT = 4 * 3600_000; // like Anki, a day rolls over at 4 am: a late episode still counts for the evening before
const FRESH_MS = 10 * 60_000;

const pad = (n: number) => String(n).padStart(2, '0');
export function dayKey(ms: number): string {
  const d = new Date(ms - DAY_SHIFT);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------------------------------------------------------------- Anki

type Rev = { id: number; ease: number; ivl: number; lastIvl: number; time: number; type: number };
type CardRow = { cardId: number; lapses: number; interval: number; deckName: string; fields: Record<string, { value: string; order: number }> };

type AnkiDays = Record<string, { reviews: number; minutes: number; learned: number }>;
type AnkiCache = { stats: AnkiStats; days: AnkiDays };

const ANKI_FILE = path.join(DATA_DIR, 'analytics-anki.json');
let ankiCache: AnkiCache | undefined = (() => {
  try {
    const cached = JSON.parse(fs.readFileSync(ANKI_FILE, 'utf8')) as AnkiCache;
    return cached.stats?.answersAll ? cached : undefined; // written by an older version
  } catch {
    return undefined;
  }
})();

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\[[^\]]*\]/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

async function fetchAnki(): Promise<AnkiCache> {
  const query = getSettings().knownWordsQuery.trim();
  const scope = query ? `(${query}) ` : 'deck:* ';

  // Reviews done on the phone only reach the laptop through AnkiWeb, so pull them first (best effort).
  await invoke('sync').catch((e) => log.warn('AnkiWeb sync before analytics failed:', (e as Error).message));

  // Every card that has been studied, then its complete review log.
  const ids = await invoke<number[]>('findCards', { query: `${scope}-is:new` });
  const logs: Record<string, Rev[]> = {};
  for (let i = 0; i < ids.length; i += 400) {
    Object.assign(logs, await invoke<Record<string, Rev[]>>('getReviewsOfCards', { cards: ids.slice(i, i + 400).map(String) }));
  }

  const days = new Map<string, { reviews: number; ms: number; learned: number }>();
  const hours = new Array<number>(24).fill(0);
  const answers = { again: 0, hard: 0, good: 0, easy: 0 };
  const answersAll = { again: 0, hard: 0, good: 0, easy: 0 };
  let reviewCards = 0;
  let reviewPassed = 0;
  let allCards = 0;
  let allPassed = 0;
  let reviews = 0;
  let ms = 0;
  let firstDay: string | undefined;
  const since30 = Date.now() - 30 * 86400_000;
  const since180 = Date.now() - 180 * 86400_000;
  for (const list of Object.values(logs)) {
    const entries = list.filter((r) => r.ease > 0 && r.type <= 3).sort((a, b) => a.id - b.id);
    entries.forEach((r, i) => {
      const key = dayKey(r.id);
      const d = days.get(key) ?? { reviews: 0, ms: 0, learned: 0 };
      d.reviews++;
      d.ms += r.time;
      if (i === 0) d.learned++;
      days.set(key, d);
      reviews++;
      ms += r.time;
      if (!firstDay || key < firstDay) firstDay = key;
      if (r.id >= since180) hours[new Date(r.id).getHours()]++;
      const button = (['again', 'hard', 'good', 'easy'] as const)[Math.min(3, r.ease - 1)];
      answersAll[button]++;
      if (r.type === 1) {
        allCards++;
        if (r.ease > 1) allPassed++;
      }
      if (r.id >= since30) {
        answers[button]++;
        if (r.type === 1) {
          reviewCards++;
          if (r.ease > 1) reviewPassed++;
        }
      }
    });
  }

  // Card states and the next two weeks, answered by Anki's own search so they match its statistics.
  const queries = [
    `${scope}is:learn -is:suspended`,
    `${scope}is:review prop:ivl<21 -is:suspended`,
    `${scope}is:review prop:ivl>=21 -is:suspended`,
    `${scope}is:suspended`,
    `${scope}is:new -is:suspended`,
    ...Array.from({ length: 14 }, (_, n) => `${scope}is:review -is:suspended prop:due${n === 0 ? '<=' : '='}${n}`),
  ];
  // One round trip for all of them.
  const found = await invoke<number[][]>('multi', { actions: queries.map((query) => ({ action: 'findCards', params: { query } })) });
  const [learning, young, mature, suspended, unseen] = found.slice(0, 5).map((ids) => ids.length);
  const forecast = found.slice(5).map((ids) => ids.length);

  // Cards that keep failing.
  const struggling = (await invoke<number[]>('findCards', { query: `${scope}prop:lapses>=2` })).slice(0, 400);
  const hardest: AnkiStats['hardest'] = [];
  const kanjiStats = new Map<string, { cards: number; lapses: number; example: string }>();
  if (struggling.length) {
    const rows: CardRow[] = [];
    for (let i = 0; i < struggling.length; i += 200) rows.push(...(await invoke<CardRow[]>('cardsInfo', { cards: struggling.slice(i, i + 200) })));
    rows.sort((a, b) => b.lapses - a.lapses);
    for (const c of rows.slice(0, 8)) {
      const first = Object.values(c.fields).sort((a, b) => a.order - b.order)[0];
      hardest.push({ text: stripHtml(first?.value ?? '').slice(0, 80), lapses: c.lapses, interval: c.interval, deck: c.deckName.split('::').pop() ?? c.deckName });
    }
    // Kanji that show up again and again on forgotten cards: the ones worth a closer look.
    for (const c of rows) {
      const fields = Object.values(c.fields).sort((a, b) => a.order - b.order);
      const text = stripHtml(fields.map((f) => f.value).join(' '));
      const label = stripHtml(fields[0]?.value ?? '').slice(0, 40);
      for (const k of new Set(text.match(/[㐀-鿿]/g) ?? [])) {
        const s = kanjiStats.get(k) ?? { cards: 0, lapses: 0, example: label };
        s.cards++;
        s.lapses += c.lapses;
        kanjiStats.set(k, s);
      }
    }
  }
  const weakKanji = [...kanjiStats]
    .filter(([, s]) => s.cards >= 2)
    .sort(([, x], [, y]) => y.lapses - x.lapses || y.cards - x.cards)
    .slice(0, 12)
    .map(([kanji, s]) => ({ kanji, ...s }));

  const stats: AnkiStats = {
    asOf: new Date().toISOString(),
    scope: query,
    totals: { reviews, minutes: Math.round(ms / 60000), cardsReviewed: ids.length, firstDay },
    retention30: reviewCards >= 10 ? reviewPassed / reviewCards : null,
    retentionAll: allCards >= 10 ? allPassed / allCards : null,
    answers30: answers,
    answersAll,
    hours,
    states: { learning, young, mature, suspended, unseen },
    forecast,
    hardest,
    weakKanji,
  };
  const perDay: AnkiDays = {};
  for (const [key, v] of days) perDay[key] = { reviews: v.reviews, minutes: Math.round(v.ms / 600) / 100, learned: v.learned };
  return { stats, days: perDay };
}

let inflight: Promise<void> | undefined;
/** Reads the review history from Anki (starting Anki first when `start` is set). Single flight. */
export function refreshAnki(start = false): Promise<void> {
  inflight ??= (async () => {
    if (!(await ankiOnline())) {
      if (!start) return;
      await ensureAnki();
    }
    const t0 = Date.now();
    ankiCache = await fetchAnki();
    writeJsonAtomic(ANKI_FILE, ankiCache);
    log.info(`Anki analytics: ${ankiCache.stats.totals.reviews} reviews of ${ankiCache.stats.totals.cardsReviewed} cards (${Date.now() - t0} ms)`);
  })().finally(() => (inflight = undefined));
  return inflight;
}

// ---------------------------------------------------------------- vocabulary history

// The known-word estimate is a moving target (Anki reviews, manual marks), so the only way to get a growth
// curve is to write down its size once a day. The last value of a day wins.
const VOCAB_FILE = path.join(DATA_DIR, 'vocab-history.json');
const vocab: Record<string, VocabPoint> = (() => {
  try {
    return JSON.parse(fs.readFileSync(VOCAB_FILE, 'utf8')) as Record<string, VocabPoint>;
  } catch {
    return {};
  }
})();

/** Stores today's known-word count (no-op when unchanged and when the count is still empty). */
export async function snapshotVocab(): Promise<void> {
  const total = (await knownSet()).size;
  if (!total) return;
  const { anki, manual } = knownSummary();
  const day = dayKey(Date.now());
  const prev = vocab[day];
  if (prev && prev.total === total && prev.anki === anki && prev.manual === manual) return;
  vocab[day] = { total, anki, manual };
  writeJsonAtomic(VOCAB_FILE, vocab);
}

// ---------------------------------------------------------------- payload

export async function analytics(): Promise<Analytics> {
  const online = await ankiOnline();
  if (online && (!ankiCache || Date.now() - Date.parse(ankiCache.stats.asOf) > FRESH_MS)) {
    // Quick on small collections; on a big one the page gets the cached numbers and the next call the new ones.
    await Promise.race([refreshAnki().catch((e) => log.warn('Anki analytics:', (e as Error).message)), new Promise((r) => setTimeout(r, 6000))]);
  }
  const ankiDays = ankiCache?.days ?? {};
  await snapshotVocab();

  const moments = store.listMoments();
  const horuDays = new Map<string, { marked: number; cards: number; episodes: number; chapters: number; watched: number }>();
  const horuDay = (key: string) => {
    let d = horuDays.get(key);
    if (!d) horuDays.set(key, (d = { marked: 0, cards: 0, episodes: 0, chapters: 0, watched: 0 }));
    return d;
  };
  const hours = new Array<number>(24).fill(0);
  const weekdays = new Array<number>(7).fill(0);
  const kinds = new Map<string, { kind: string; marked: number; cards: number }>();
  const titles = new Map<string, { title: string; kind: string; cards: number; marked: number }>();
  for (const m of moments) {
    const at = Date.parse(m.createdAt);
    const d = horuDay(dayKey(at));
    d.marked++;
    if (m.status === 'done') d.cards++;
    hours[new Date(at).getHours()]++;
    weekdays[(new Date(at - DAY_SHIFT).getDay() + 6) % 7]++;
    const k = kinds.get(m.kind) ?? { kind: m.kind, marked: 0, cards: 0 };
    k.marked++;
    if (m.status === 'done') k.cards++;
    kinds.set(m.kind, k);
    const key = `${m.kind}:${m.title}`;
    const t = titles.get(key) ?? { title: m.title, kind: m.kind, cards: 0, marked: 0 };
    t.marked++;
    if (m.status === 'done') t.cards++;
    titles.set(key, t);
  }
  const watchedBy = new Map<string, { title: string; minutes: number; episodes: Map<number, number> }>();
  let watchMinutes = 0;
  const watchSeconds = new Map<string, number>(); // by day
  const episodeSeconds = new Map<string, number>(); // by anime + episode
  for (const s of store.allSessions()) {
    let seconds = 0;
    for (const [day, sec] of Object.entries(s.watch ?? {})) {
      horuDay(day).watched += sec / 60;
      watchSeconds.set(day, (watchSeconds.get(day) ?? 0) + sec);
      if (sec >= WATCH_BLOCK_SECONDS) horuDay(day).episodes++;
      seconds += sec;
    }
    if (!seconds) continue;
    const episodeKey = `${s.jimakuEntryId ?? s.title}:${s.episode}`;
    episodeSeconds.set(episodeKey, (episodeSeconds.get(episodeKey) ?? 0) + seconds);
    watchMinutes += seconds / 60;
    const w = watchedBy.get(s.title) ?? { title: s.title, minutes: 0, episodes: new Map<number, number>() };
    w.minutes += seconds / 60;
    w.episodes.set(s.episode, (w.episodes.get(s.episode) ?? 0) + seconds / 60);
    watchedBy.set(s.title, w);
  }
  for (const c of allChapters()) if (c.readAt) horuDay(dayKey(Date.parse(c.readAt))).chapters++;

  const watchBlocks = watchBlocksByDay(watchSeconds);
  const allBlocks = [...watchBlocks.values()].reduce((n, b) => n + b, 0);
  const readByDay = wordsReadByDay();
  const readBlocks = (day: string) => Math.floor((readByDay[day] ?? 0) / READ_BLOCK_WORDS);
  const allReadBlocks = Object.keys(readByDay).reduce((n, day) => n + readBlocks(day), 0);

  const days: DayStat[] = [];
  const seen = new Set<string>();
  for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
    const day = dayKey(Date.now() - i * 86400_000);
    if (seen.has(day)) continue;
    seen.add(day);
    const a = ankiDays[day] ?? { reviews: 0, minutes: 0, learned: 0 };
    const h = horuDays.get(day) ?? { marked: 0, cards: 0, episodes: 0, chapters: 0, watched: 0 };
    days.push({
      day,
      ...a,
      ...h,
      watched: Math.round(h.watched),
      watchBlocks: watchBlocks.get(day) ?? 0,
      read: readByDay[day] ?? 0,
      readBlocks: readBlocks(day),
      xp:
        a.reviews * XP.review +
        h.marked * XP.mark +
        h.cards * XP.card +
        (watchBlocks.get(day) ?? 0) * XP.watchBlock +
        h.chapters * XP.chapter +
        readBlocks(day) * XP.readBlock,
    });
  }

  const today = days[days.length - 1];
  const streak = streaks(days, ankiCache ? dayKey(Date.parse(ankiCache.stats.asOf)) : undefined);

  // Lifetime XP from everything we know, not just the heatmap window.
  const allReviews = ankiCache?.stats.totals.reviews ?? 0;
  const episodes = [...episodeSeconds.values()].filter((sec) => sec >= WATCH_BLOCK_SECONDS).length;
  const chapters = allChapters().filter((c) => c.readAt).length;
  const done = moments.filter((m) => m.status === 'done').length;
  const xp = allReviews * XP.review + moments.length * XP.mark + done * XP.card + allBlocks * XP.watchBlock + chapters * XP.chapter + allReadBlocks * XP.readBlock;

  const summary = knownSummary();
  return {
    generatedAt: new Date().toISOString(),
    today: today.day,
    goal: getSettings().dailyGoalXp,
    days,
    totals: {
      xp,
      marked: moments.length,
      cards: done,
      discarded: moments.filter((m) => m.status === 'discarded').length,
      inbox: store.inboxMoments().length,
      episodes,
      chapters,
      reviews: allReviews,
      minutes: ankiCache?.stats.totals.minutes ?? 0,
      watchMinutes: Math.round(watchMinutes),
      prepared: preparedCount(),
      knownWords: (await knownSet()).size,
      wordsRead: Object.values(readByDay).reduce((n, w) => n + w, 0),
    },
    streak,
    level: levelOf(xp),
    horu: {
      hours,
      weekdays,
      byKind: [...kinds.values()].sort((a, b) => b.marked - a.marked),
      watched: [...watchedBy.values()]
        .sort((x, y) => y.minutes - x.minutes)
        .slice(0, 10)
        .map((w) => ({
          title: w.title,
          minutes: Math.round(w.minutes),
          episodes: [...w.episodes].sort(([x], [y]) => x - y).map(([episode, minutes]) => ({ episode, minutes: Math.round(minutes) })),
        })),
      titles: [...titles.values()].sort((a, b) => b.cards - a.cards || b.marked - a.marked).slice(0, 10),
    },
    known: { total: (await knownSet()).size, anki: summary.anki, jlpt: summary.jlpt, manual: summary.manual },
    vocab: Object.entries(vocab)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, v]) => ({ day, ...v })),
    anki: {
      status: !ankiCache ? 'none' : Date.now() - Date.parse(ankiCache.stats.asOf) <= FRESH_MS ? 'live' : 'cached',
      online,
      asOf: ankiCache?.stats.asOf,
      data: ankiCache?.stats,
    },
  };
}

const h =
  (fn: (req: Request) => unknown) =>
  async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await fn(req));
    } catch (err) {
      log.warn(`analytics ${req.path}:`, (err as Error).message);
      res.status(400).json({ error: (err as Error).message });
    }
  };

export function analyticsRouter(): express.Router {
  const r = express.Router();
  r.get('/', h(() => analytics()));
  /** "Update from Anki": starts Anki if needed (up to a minute), then re-reads the review history. */
  r.post(
    '/anki',
    h(async () => {
      await refreshAnki(true);
      return analytics();
    }),
  );
  return r;
}
