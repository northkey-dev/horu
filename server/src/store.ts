import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, MEDIA_DIR, SUBS_DIR, safeId, writeJsonAtomic } from './config.ts';
import type { Cue, Moment, Session } from '../../shared/types.ts';

// A tiny JSON-file store. Single user, a few thousand records at most.

type Db = {
  moments: Moment[];
  sessions: Session[];
  activeSessionId?: string;
  /** Last episode watched per Jimaku entry, for "next episode" suggestions. */
  lastEpisode: Record<string, number>;
};

const DB_FILE = path.join(DATA_DIR, 'db.json');

const db: Db = (() => {
  try {
    return { lastEpisode: {}, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
  } catch {
    return { moments: [], sessions: [], lastEpisode: {} };
  }
})();

let saveTimer: NodeJS.Timeout | undefined;
function save(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeJsonAtomic(DB_FILE, db), 200);
}

export function flush(): void {
  clearTimeout(saveTimer);
  writeJsonAtomic(DB_FILE, db);
}

// ---- moments ----

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function addMoment(moment: Moment): Moment {
  safeId(moment.id);
  db.moments.push(moment);
  save();
  return moment;
}

export function getMoment(id: string): Moment | undefined {
  return db.moments.find((m) => m.id === id);
}

export function updateMoment(id: string, patch: Partial<Moment>): Moment | undefined {
  const moment = getMoment(id);
  if (!moment) return undefined;
  Object.assign(moment, patch);
  save();
  return moment;
}

/**
 * Deletes a file that Whisper or ffmpeg may still have open. Windows refuses
 * (EPERM/EBUSY) until the reader closes it, so locked files are retried later.
 */
export function removeFile(file: string, attempt = 0): void {
  try {
    fs.rmSync(file, { force: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if ((code === 'EPERM' || code === 'EBUSY') && attempt < 20) setTimeout(() => removeFile(file, attempt + 1), 3000).unref();
    else throw err;
  }
}

export function removeMedia(id: string, exts = ['wav', 'mp3', 'jpg', 'clip.mp3']): void {
  for (const ext of exts) removeFile(mediaPath(id, ext));
}

export function deleteMoment(id: string): void {
  db.moments = db.moments.filter((m) => m.id !== id);
  removeMedia(id, ['wav', 'mp3', 'jpg', 'clip.mp3', 'src']);
  save();
}

/** Takes the moment out of the inbox. Media stays for a few days so it can be restored (see purgeOldMedia). */
export function discardMoment(id: string): void {
  updateMoment(id, { status: 'discarded' });
}

/** Puts a finished or discarded moment back into the inbox. */
export function restoreMoment(id: string): Moment | undefined {
  const m = getMoment(id);
  if (!m || (m.status !== 'done' && m.status !== 'discarded')) return undefined;
  return updateMoment(id, { status: 'ready', error: undefined });
}

/** Frees audio and images of finished/discarded moments after `days`; the records stay for history and statistics. */
export function purgeOldMedia(days: number): number {
  const cutoff = Date.now() - days * 86_400_000;
  let n = 0;
  for (const m of db.moments) {
    if ((m.status !== 'done' && m.status !== 'discarded') || Date.parse(m.createdAt) > cutoff || (!m.hasAudio && !m.hasImage)) continue;
    removeMedia(m.id, ['wav', 'mp3', 'jpg', 'clip.mp3', 'src']);
    m.hasAudio = false;
    m.hasImage = false;
    n++;
  }
  if (n) save();
  return n;
}

export function listMoments(filter?: (m: Moment) => boolean): Moment[] {
  return (filter ? db.moments.filter(filter) : db.moments).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const INBOX_STATUSES = new Set(['capturing', 'transcribing', 'ready', 'creating', 'error']);
export function inboxMoments(): Moment[] {
  return listMoments((m) => INBOX_STATUSES.has(m.status));
}

export function mediaPath(id: string, ext: string): string {
  return path.join(MEDIA_DIR, `${safeId(id)}.${ext}`);
}

// ---- sessions ----

const subsFile = (id: string) => path.join(SUBS_DIR, `${safeId(id)}.json`);

export function addSession(session: Session, cues: Cue[]): Session {
  const file = subsFile(session.id);
  db.sessions.push(session);
  db.activeSessionId = session.id;
  if (session.jimakuEntryId) db.lastEpisode[String(session.jimakuEntryId)] = session.episode;
  writeJsonAtomic(file, cues);
  save();
  return session;
}

/** A session the phone ran on its own. Stored like any other but not made active; the phone's watch time wins. */
export function importSession(session: Session, cues: Cue[] | undefined): void {
  const file = subsFile(session.id);
  const existing = getSession(session.id);
  if (existing) Object.assign(existing, session);
  else db.sessions.push(session);
  if (session.jimakuEntryId) db.lastEpisode[String(session.jimakuEntryId)] = Math.max(db.lastEpisode[String(session.jimakuEntryId)] ?? 0, session.episode);
  if (cues) writeJsonAtomic(file, cues);
  save();
}

/** Changes what a session says about itself (title, episode, ...), not its subtitle lines. */
export function updateSession(id: string, patch: Partial<Session>): Session | undefined {
  const session = getSession(id);
  if (!session) return undefined;
  Object.assign(session, patch);
  if (session.jimakuEntryId) db.lastEpisode[String(session.jimakuEntryId)] = session.episode;
  save();
  return session;
}

export function updateSessionCues(id: string, cues: Cue[], subtitleName?: string): void {
  const session = getSession(id);
  if (!session) return;
  session.cueCount = cues.length;
  session.subtitleName = subtitleName;
  writeJsonAtomic(subsFile(id), cues);
  save();
}

export function getSession(id: string | undefined): Session | undefined {
  return id ? db.sessions.find((s) => s.id === id) : undefined;
}

export function activeSession(): Session | undefined {
  return getSession(db.activeSessionId);
}

export function endSession(): void {
  db.activeSessionId = undefined;
  save();
}

export function sessionCues(id: string): Cue[] {
  try {
    return JSON.parse(fs.readFileSync(subsFile(id), 'utf8'));
  } catch {
    return [];
  }
}

export function lastEpisode(entryId: number): number | undefined {
  return db.lastEpisode[String(entryId)];
}

export function recentSessions(limit = 10): Session[] {
  const seen = new Set<string>();
  const out: Session[] = [];
  for (const s of db.sessions.slice().reverse()) {
    const key = s.jimakuEntryId ? String(s.jimakuEntryId) : s.title;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

export function addWatchTime(id: string, day: string, seconds: number): void {
  const session = getSession(id);
  if (!session) return;
  session.watch ??= {};
  session.watch[day] = (session.watch[day] ?? 0) + seconds;
  save();
}

export function markListSynced(id: string): void {
  const session = getSession(id);
  if (!session) return;
  session.listSynced = true;
  save();
}

export function allSessions(): Session[] {
  return db.sessions;
}
