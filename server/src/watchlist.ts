import path from 'node:path';
import { DATA_DIR, writeJsonAtomic } from './config.ts';
import { readJsonKeepingDamaged } from './jsonFile.ts';
import { listManga } from './manga/library.ts';
import * as store from './store.ts';
import { cleanList, mergeLists, type Watchlist } from '../../shared/watchlist.ts';

// The List tab (shared/watchlist.ts). The phone keeps the list and talks to AniList itself; the laptop keeps a copy
// that is part of the backup and that a second phone or the laptop's own browser picks up. It also tells the List
// what was watched and read here, the seeds of the recommendations.

const FILE = path.join(DATA_DIR, 'watchlist.json');
let list: Watchlist = cleanList(readJsonKeepingDamaged<unknown>(FILE, () => ({})));

export const getWatchlist = (): Watchlist => list;

export function mergeIntoWatchlist(input: unknown): Watchlist {
  const next = mergeLists(list, cleanList(input));
  if (JSON.stringify(next) !== JSON.stringify(list)) {
    list = next;
    writeJsonAtomic(FILE, list);
  }
  return list;
}

export type WatchHistory = {
  /** One per anime: the AniList id when it is known, seconds of video played, the last time */
  anime: { title: string; anilistId?: number; seconds: number; at: string }[];
  manga: { title: string; at: string }[];
};

export function watchHistory(): WatchHistory {
  const anime = new Map<string, WatchHistory['anime'][number]>();
  for (const s of store.allSessions()) {
    const key = s.anilistId ? `a${s.anilistId}` : s.jimakuEntryId ? `j${s.jimakuEntryId}` : s.title.toLowerCase();
    const seconds = Object.values(s.watch ?? {}).reduce((a, b) => a + b, 0);
    const had = anime.get(key);
    if (had) {
      had.seconds += seconds;
      if (s.createdAt > had.at) had.at = s.createdAt;
      had.anilistId ??= s.anilistId;
    } else anime.set(key, { title: s.title, anilistId: s.anilistId, seconds, at: s.createdAt });
  }
  // Japanese manga only: English ones are kept apart from the learning side.
  const manga = listManga()
    .filter((m) => (m.lang ?? 'ja') === 'ja')
    .map((m) => ({ title: m.title, at: m.lastReadAt ?? m.addedAt }));
  const byTime = <T extends { at: string }>(a: T, b: T) => b.at.localeCompare(a.at);
  return { anime: [...anime.values()].sort(byTime), manga: manga.sort(byTime) };
}
