import { getSettings } from './config.ts';
import { log } from './log.ts';
import * as store from './store.ts';
import { anilistWatched, WATCHED_SECONDS } from '../../shared/anilist.ts';

// Ticks off watched episodes in the user's AniList list (Settings → AniList). An episode counts once about
// two thirds of it played, from the extension or the phone's episode clock.

let running = false;

export async function syncLists(): Promise<void> {
  const token = getSettings().anilistToken.trim();
  if (!token || running) return;
  running = true;
  try {
    for (const s of store.allSessions()) {
      if (!s.anilistId || s.listSynced) continue;
      const watched = Object.values(s.watch ?? {}).reduce((a, b) => a + b, 0);
      if (watched < WATCHED_SECONDS) continue;
      try {
        const progress = await anilistWatched(token, s.anilistId, s.episode);
        store.markListSynced(s.id);
        log.info(`AniList: ${s.title} at episode ${progress}`);
      } catch (err) {
        log.warn('AniList update failed', (err as Error).message);
        return; // token expired or AniList down: try again next round
      }
    }
  } finally {
    running = false;
  }
}

export function startListSync(): void {
  setInterval(() => void syncLists(), 2 * 60_000).unref();
  setTimeout(() => void syncLists(), 30_000).unref();
}
