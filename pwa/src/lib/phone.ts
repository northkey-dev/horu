import { candidatesAt } from '../../../shared/subtitles.ts';
import { cuesFromUpload, jimakuClient } from '../../../shared/jimaku.ts';
import type { Cue, JimakuEntry, JimakuFile, Moment, Session } from '../../../shared/types.ts';
import { laptopUrl } from './laptop.ts';
import { micClip } from './mic.ts';
import { recall, remember } from './mirror.ts';
import { formatTime } from './hooks.ts';
import { anilistWatched, WATCHED_SECONDS } from '../../../shared/anilist.ts';

// Watching without the laptop (laptop off, or the episode runs on a TV app the extension cannot see).
// The phone runs an episode clock that you start with the episode and nudge to match; a mark takes the clock
// time, the subtitle lines around it (the phone loads them from Jimaku itself) and, if switched on, the last
// seconds of microphone sound. Sessions and marks stay on the phone until the laptop is reachable, then they
// move there and continue like laptop marks (Whisper, Claude, Anki).

export type Clock = { running: boolean; base: number; anchor: number };
/** `clockLog` keeps the clock settings that applied until a moment (ms), so a mark from the past (coming back
 *  to the app, a Shortcut) lands on the right episode time even after a pause or nudge. */
export type PhoneSession = Session & { clock: Clock; marks: number; cuesSent?: boolean; dirty?: boolean; clockLog?: { until: number; clock: Clock }[] };

const CURRENT = 'horu-phone-session';
const SESSIONS = 'horu-phone-sessions';
const MOMENTS = 'horu-local-moments';
const KEY = 'horu-jimaku-key';
const MIC = 'horu-mic';
const MEDIA = 'horu-local-media';

function read<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage blocked: the phone forgets after closing
  }
  dispatchEvent(new Event('horu-phone'));
}

const newId = () => `ph${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const isPhoneSession = (id?: string) => Boolean(id?.startsWith('ph'));

// Same day boundary as the laptop (4 am, like Anki), so phone watch time lands on the right day.
const pad = (n: number) => String(n).padStart(2, '0');
function dayKey(ms: number): string {
  const d = new Date(ms - 4 * 3600_000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---- phone settings ----

export const phoneJimakuKey = () => read<string>(KEY, '');
export const setPhoneJimakuKey = (key: string) => write(KEY, key.trim());
export const micWanted = () => read<boolean>(MIC, false);
export const setMicWanted = (on: boolean) => write(MIC, on);
export const MIC_SECONDS = 20;
/** Watch → Continue: one tap starts the next episode (off: the tap opens the episode page first). */
export const quickContinue = () => read<boolean>('horu-quick-continue', false);
export const setQuickContinue = (on: boolean) => write('horu-quick-continue', on);
/** A line opened in the reader starts translating right away, so Translate has its answer ready. */
export const translatesAhead = () => read<boolean>('horu-translate-ahead', true);
export const setTranslatesAhead = (on: boolean) => write('horu-translate-ahead', on);
/** A translation also goes through the line word by word. */
export const wordByWord = () => read<boolean>('horu-word-by-word', true);
export const setWordByWord = (on: boolean) => write('horu-word-by-word', on);
/** The inbox as a list, or one moment at a time. */
export const inboxView = () => read<'list' | 'swipe'>('horu-inbox-view', 'list');
export const setInboxView = (view: 'list' | 'swipe') => write('horu-inbox-view', view);
export const anilistToken = () => read<string>('horu-anilist', '');
export const setAnilistToken = (token: string) => write('horu-anilist', token.trim());

export const phoneJimaku = jimakuClient(phoneJimakuKey);

// ---- the episode clock ----

export function videoTime(c: Clock, now = Date.now()): number {
  return Math.max(0, c.running ? c.base + (now - c.anchor) / 1000 : c.base);
}

export const currentSession = () => read<PhoneSession | null>(CURRENT, null);

function saveCurrent(s: PhoneSession | null): void {
  write(CURRENT, s);
  if (s) {
    const list = read<PhoneSession[]>(SESSIONS, []).filter((x) => x.id !== s.id);
    write(SESSIONS, [{ ...s, dirty: true }, ...list].slice(0, 20));
  }
}

let accruedAt = Date.now();
/** Adds the clock's running time since the last call to today's watch time (counts for XP and the streak). */
function accrue(s: PhoneSession): PhoneSession {
  const now = Date.now();
  if (s.clock.running) {
    const day = dayKey(now);
    const add = Math.min((now - accruedAt) / 1000, 60);
    s = { ...s, watch: { ...s.watch, [day]: Math.round((s.watch?.[day] ?? 0) + add) } };
  }
  accruedAt = now;
  return s;
}

export function updateClock(fn: (c: Clock, t: number) => Clock): void {
  const s = currentSession();
  if (!s) return;
  const next = accrue(s);
  const clockLog = [...(next.clockLog ?? []), { until: Date.now(), clock: next.clock }].slice(-30);
  saveCurrent({ ...next, clockLog, clock: fn(next.clock, videoTime(next.clock)) });
}

/** Episode time at a past moment (ms), from the clock that applied then. */
export function videoTimeAt(s: PhoneSession, at: number): number {
  const then = s.clockLog?.find((e) => e.until > at)?.clock ?? s.clock;
  return videoTime(then, at);
}

export const startClock = () => updateClock((c, t) => ({ running: true, base: t, anchor: Date.now() }));
export const pauseClock = () => updateClock((c, t) => ({ running: false, base: t, anchor: Date.now() }));
export const nudgeClock = (seconds: number) => updateClock((c, t) => ({ ...c, base: Math.max(0, t + seconds), anchor: Date.now() }));
export const setClock = (seconds: number) => updateClock((c) => ({ ...c, base: Math.max(0, seconds), anchor: Date.now() }));

/** Takes position and play state from a media player the laptop watches (Jellyfin, Plex, Kodi, mpv). */
export const followClock = (position: number, playing: boolean) => updateClock(() => ({ running: playing, base: Math.max(0, position), anchor: Date.now() }));

/** Saves the watch time every few seconds while the clock runs (called by the Watch screen). */
export function tickClock(): void {
  const s = currentSession();
  if (!s?.clock.running) return;
  const next = accrue(s);
  saveCurrent(next);
  void tickOffList(next);
}

/** Ticks the episode off in AniList once enough of it played (the laptop does the same for its sessions). */
async function tickOffList(s: PhoneSession): Promise<void> {
  const token = anilistToken();
  const watched = Object.values(s.watch ?? {}).reduce((a, b) => a + b, 0);
  if (!token || !s.anilistId || s.listSynced || watched < WATCHED_SECONDS) return;
  saveCurrent({ ...s, listSynced: true });
  await anilistWatched(token, s.anilistId, s.episode).catch(() => {
    const now = currentSession();
    if (now?.id === s.id) saveCurrent({ ...now, listSynced: false });
  });
}

// ---- sessions ----

export async function startPhoneSession(opts: { title: string; entry?: JimakuEntry; episode: number; file?: JimakuFile }): Promise<{ warning?: string }> {
  let cues: Cue[] = [];
  let subtitleName: string | undefined;
  let warning: string | undefined;
  if (opts.file) {
    try {
      ({ name: subtitleName, cues } = await phoneJimaku.downloadCues(opts.file, opts.episode));
    } catch (e) {
      warning = `Subtitles could not be loaded: ${(e as Error).message}`;
    }
  } else if (opts.entry) warning = 'No Japanese subtitles for this episode. With the microphone on, Whisper transcribes your marks once the laptop has them.';
  const session: PhoneSession = {
    id: newId(),
    createdAt: new Date().toISOString(),
    title: opts.title,
    jimakuEntryId: opts.entry?.id,
    anilistId: opts.entry?.anilist_id ?? undefined,
    episode: opts.episode,
    subtitleName,
    cueCount: cues.length,
    clock: { running: false, base: 0, anchor: Date.now() },
    marks: 0,
  };
  await remember(`cues:${session.id}`, cues);
  accruedAt = Date.now();
  saveCurrent(session);
  void announceWatching(true);
  return { warning };
}

export function endPhoneSession(): void {
  const s = currentSession();
  if (s) saveCurrent({ ...accrue(s), clock: { ...s.clock, running: false } });
  write(CURRENT, null);
  void announceWatching(false);
}

/**
 * Tells the laptop that an episode runs on this phone, so it takes marks from a Shortcut (Back Tap) only then.
 * While the Watch screen is open every pick-up renews it. No laptop, nothing to tell.
 */
async function announceWatching(on: boolean): Promise<void> {
  try {
    await fetch(laptopUrl('/api/mark/remote/watching'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ on }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // laptop away or not paired
  }
}

export async function sessionCues(id: string): Promise<Cue[]> {
  return (await recall<Cue[]>(`cues:${id}`))?.value ?? [];
}

export async function loadSubtitleFile(file: File): Promise<number> {
  const s = currentSession();
  if (!s) return 0;
  const { name, cues } = cuesFromUpload(file.name, new Uint8Array(await file.arrayBuffer()), s.episode);
  if (!cues.length) throw new Error('No subtitle lines found in that file');
  await remember(`cues:${s.id}`, cues);
  saveCurrent({ ...s, subtitleName: name, cueCount: cues.length, cuesSent: false });
  // Marks made before the file arrived get their lines now.
  for (const m of localMoments().filter((m) => m.sessionId === s.id && m.videoTime !== undefined))
    saveMoment({ ...m, candidates: candidatesAt(cues, m.videoTime!, m.audioDuration ?? MIC_SECONDS) });
  return cues.length;
}

/** Recent phone sessions for "Continue" (next episode per anime). */
export function recentPhoneSessions(): (Session & { nextEpisode: number })[] {
  return read<PhoneSession[]>(SESSIONS, []).map((s) => ({ ...s, nextEpisode: s.episode + 1 }));
}

// ---- marks ----

export const localMoments = () => read<Moment[]>(MOMENTS, []);
export const isLocalMoment = (id: string) => localMoments().some((m) => m.id === id);
export const localMediaUrl = (id: string) => new URL(`local-media/${id}.wav`, location.href).href;

function saveMoment(m: Moment): void {
  write(MOMENTS, [m, ...localMoments().filter((x) => x.id !== m.id)]);
}

/** Marks now, or at a moment shortly before (`at`, ms: when you left the app, a Shortcut tap). */
export async function markPhone(at?: number): Promise<Moment> {
  const s = currentSession();
  if (!s) throw new Error('No episode running');
  const past = at !== undefined && Date.now() - at > 3000;
  const t = at !== undefined ? videoTimeAt(s, at) : videoTime(s.clock);
  // The microphone holds the last seconds, not the moment you left.
  const clip = past ? undefined : micClip();
  const window = clip?.seconds ?? MIC_SECONDS;
  const cues = await sessionCues(s.id);
  const moment: Moment = {
    id: newId(),
    kind: 'anime',
    createdAt: new Date(at ?? Date.now()).toISOString(),
    status: 'ready',
    sessionId: s.id,
    title: s.title,
    episode: s.episode,
    sourceLabel: `${s.title} · Ep ${s.episode} · ${formatTime(t)}`,
    videoTime: t,
    audioStart: clip ? t - clip.seconds : undefined,
    audioDuration: window,
    hasAudio: Boolean(clip),
    hasImage: false,
    candidates: candidatesAt(cues, t, window),
  };
  if (clip && typeof caches !== 'undefined') await (await caches.open(MEDIA)).put(localMediaUrl(moment.id), new Response(clip.wav));
  saveMoment(moment);
  saveCurrent({ ...accrue(currentSession() ?? s), marks: s.marks + 1 });
  return moment;
}

/** Marks sent to the laptop by a Shortcut (Back Tap, Action button, Siri) while this phone runs the clock. */
export async function takeRemoteMarks(): Promise<number> {
  const s = currentSession();
  if (!s) return 0;
  const res = await fetch(laptopUrl('/api/mark/remote/take'), { method: 'POST', signal: AbortSignal.timeout(5000) });
  if (!res.ok) return 0;
  const { marks } = (await res.json()) as { marks: number[] };
  const started = s.clockLog?.[0]?.until ?? 0;
  for (const at of marks.filter((at) => at >= started)) await markPhone(at);
  return marks.length;
}

/** A sentence from the text reader goes to the inbox (on the phone first, like every phone mark). */
export function mineText(sentence: string, word: string, title: string, source: string): Moment {
  const moment: Moment = {
    id: newId(),
    kind: 'text',
    createdAt: new Date().toISOString(),
    status: 'ready',
    title,
    sourceLabel: source && source !== title ? `${source} · ${title}` : title,
    hasAudio: false,
    hasImage: false,
    candidates: [{ start: 0, end: 0, text: sentence, source: 'text' }],
    targetHint: word,
  };
  saveMoment(moment);
  return moment;
}

/** A line of a recording (podcast, audio book) goes to the inbox with its sound, like a mark. */
export async function mineAudioLine(
  line: { start: number; end: number; text: string },
  word: string,
  title: string,
  clip: { wav: Blob; clipStart: number; seconds: number } | undefined,
): Promise<Moment> {
  const moment: Moment = {
    ...mineText(line.text, word, title, 'Audio'),
    candidates: [{ start: line.start, end: line.end, text: line.text, source: 'subs' }],
    sourceLabel: `${title} · ${formatTime(line.start)}`,
    videoTime: line.end,
    audioStart: clip?.clipStart,
    audioDuration: clip?.seconds,
    hasAudio: Boolean(clip),
  };
  if (clip && typeof caches !== 'undefined') await (await caches.open(MEDIA)).put(localMediaUrl(moment.id), new Response(clip.wav));
  saveMoment(moment);
  return moment;
}

/** Removes the newest mark of the running episode (Undo), if it is from the last 15 minutes. */
export async function undoPhone(): Promise<Moment | undefined> {
  const s = currentSession();
  const last = localMoments().find((m) => m.sessionId === s?.id);
  if (!s || !last || Date.now() - Date.parse(last.createdAt) > 15 * 60_000) return undefined;
  await dropLocal(last.id);
  saveCurrent({ ...s, marks: Math.max(0, s.marks - 1) });
  return last;
}

/** The phone made the card itself; the mark leaves the inbox and moves to the laptop later for the history. */
export function markLocalDone(id: string, card: { cardSentence: string; cardTarget: string }): void {
  const m = localMoments().find((x) => x.id === id);
  if (m) saveMoment({ ...m, status: 'done', error: undefined, ...card });
}

export async function dropLocal(id: string): Promise<void> {
  write(MOMENTS, localMoments().filter((m) => m.id !== id));
  if (typeof caches !== 'undefined') await (await caches.open(MEDIA)).delete(localMediaUrl(id));
}

// ---- moving everything to the laptop ----

async function post(path: string, body: unknown): Promise<void> {
  const res = await fetch(laptopUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

let syncing: Promise<void> | undefined;
let sessionsSentAt = 0;

/** Sends phone sessions and marks to the laptop. Called whenever the laptop answers; safe to call often. */
export function syncPhone(): Promise<void> {
  syncing ??= (async () => {
    try {
      await takeRemoteMarks().catch(() => 0);
      // The laptop's key lets the phone load subtitles itself next time the laptop is off.
      if (!phoneJimakuKey()) {
        const res = await fetch(laptopUrl('/api/jimaku/key'), { signal: AbortSignal.timeout(5000) }).catch(() => undefined);
        const key = res?.ok ? ((await res.json()) as { key?: string }).key : undefined;
        if (key) setPhoneJimakuKey(key);
      }
      // The running episode changes its watch time all the time; once a minute is enough, unless marks wait
      // (their session has to be on the laptop first).
      const sessionsDue = localMoments().length > 0 || Date.now() - sessionsSentAt > 60_000;
      for (const s of sessionsDue ? read<PhoneSession[]>(SESSIONS, []).filter((x) => x.dirty) : []) {
        const { clock: _c, marks: _m, cuesSent, dirty: _d, ...session } = s;
        await post('/api/sessions/import', { session, cues: cuesSent ? undefined : await sessionCues(s.id) });
        const list = read<PhoneSession[]>(SESSIONS, []);
        // Only clear the flag if nothing changed meanwhile (the running episode keeps adding watch time).
        write(SESSIONS, list.map((x) => (x.id === s.id && JSON.stringify(x.watch) === JSON.stringify(s.watch) ? { ...x, dirty: false, cuesSent: true } : x.id === s.id ? { ...x, cuesSent: true } : x)));
      }
      if (sessionsDue) sessionsSentAt = Date.now();
      for (const m of localMoments().reverse()) {
        const hit = m.hasAudio && typeof caches !== 'undefined' ? await (await caches.open(MEDIA)).match(localMediaUrl(m.id)) : undefined;
        const audio = hit ? toBase64(new Uint8Array(await hit.arrayBuffer())) : undefined;
        await post('/api/moments/import', { moment: m, audio });
        await dropLocal(m.id);
      }
    } finally {
      syncing = undefined;
    }
  })();
  return syncing;
}

export const pendingPhone = () => localMoments().filter((m) => m.status === 'ready').length;
