import type { CardRequest, JimakuEntry, JimakuFile, Moment, Session, Settings, Status, Cue, Analytics } from '../../../shared/types.ts';
import type { WordState, WordStatus } from '../../../shared/words.ts';
import type { TranslateInput, Translation } from '../../../shared/ai.ts';
import type { DictHit, DictInfo } from '../../../shared/yomitan.ts';
import { laptopBase, laptopUrl } from './laptop.ts';
import { mirrorMedia, recall, remember } from './mirror.ts';
import { dropLocal, isLocalMoment, markLocalDone, isPhoneSession, localMediaUrl, localMoments, sessionCues, syncPhone } from './phone.ts';

// Client for the laptop service. Throws Error(message) on failures, OfflineError when the laptop is off or none
// is connected. Reads keep their last answer on the phone and fall back to it offline; a few small changes
// (discard, restore, known word) wait in an outbox until the laptop is back.

export class OfflineError extends Error {}

// A switched-off laptop behind Tailscale never answers instead of refusing, so every call gets a deadline.
// Calls that wait for Claude, Whisper, Anki or a download get the long one.
const QUICK = 10_000;
const SLOW = 180_000;

// What the last status check said. While the laptop is known to be away, calls fail at once instead of each
// waiting for its deadline; the status poll (every few seconds) notices when it is back.
let reachable: boolean | undefined;
addEventListener('horu-laptop', () => (reachable = undefined));
/** What the last status said: this Horu can make Anki cards (a Horu without Anki, e.g. on a Raspberry Pi, says no) */
let cardsHere = true;
export const laptopMakesCards = () => cardsHere;
/** The last status check reached the laptop. */
export const laptopUp = () => reachable === true;

// Why the last call failed, in words the user can act on. A browser only says "failed" for a wrong address, a
// missing VPN and a refused connection alike; what it does tell apart is a call that got no answer at all
// (a laptop that is off, asleep or behind a VPN that is not running) from one that was turned down at once.
let why = '';
export const connectionHint = (): string => why;
export function failureHint(e: Error): string {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'This phone has no internet connection.';
  if (e.name === 'TimeoutError') return 'The laptop gave no answer. Is it on and awake? Is Tailscale switched on in the phone’s Tailscale app?';
  return 'The laptop’s address could not be reached. Open the Tailscale app on the phone: it must be connected and list the laptop.';
}

const SEEN = 'horu-laptop-version';
/** The laptop version the last successful status check reported. */
export function lastLaptopVersion(): string | undefined {
  try {
    return localStorage.getItem(SEEN) ?? undefined;
  } catch {
    return undefined;
  }
}
function seenLaptop(version: string): void {
  why = '';
  try {
    localStorage.setItem(SEEN, version);
  } catch {
    // private mode: the hint just stays shorter
  }
}

async function request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, timeout = QUICK): Promise<T> {
  if (reachable === false && path !== '/api/status') throw new OfflineError('Laptop not reachable');
  let res: Response;
  try {
    res = await fetch(laptopUrl(path), {
      method,
      credentials: 'same-origin',
      headers: body !== undefined && !(body instanceof Blob) ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    why = failureHint(e as Error);
    throw new OfflineError(laptopBase() === undefined ? (e as Error).message : 'Laptop not reachable');
  }
  if (res.status === 401) throw new Error('Not paired: open the pairing link from the laptop.');
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : undefined;
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data as T;
}

/** Reads through the phone's copy: fresh from the laptop when it answers, the last answer when it does not. */
async function mirrored<T>(key: string, load: () => Promise<T>, fallback?: () => Promise<T | undefined>): Promise<T> {
  try {
    const value = await load();
    void remember(key, value);
    return value;
  } catch (e) {
    if (!(e instanceof OfflineError)) throw e;
    const copy = (await recall<T>(key))?.value ?? (await fallback?.());
    if (copy === undefined) throw e;
    return copy;
  }
}

async function patchMirror<T>(key: string, fn: (value: T) => T): Promise<void> {
  const copy = await recall<T>(key);
  if (copy) await remember(key, fn(copy.value));
}

// ---- outbox ----

type Pending = { method: string; path: string; body?: unknown };
const OUTBOX = 'horu-outbox';

function outbox(): Pending[] {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX) ?? '[]') as Pending[];
  } catch {
    return [];
  }
}

function saveOutbox(list: Pending[]): void {
  try {
    localStorage.setItem(OUTBOX, JSON.stringify(list));
  } catch {
    // storage full or blocked: the change is lost, like a failed request
  }
}

/** Sends the change, or keeps it for later when the laptop is off. */
async function orLater(method: string, path: string, body?: unknown): Promise<{ queued?: boolean }> {
  try {
    await request(method, path, body);
    return {};
  } catch (e) {
    if (!(e instanceof OfflineError)) throw e;
    // A phone that never had a laptop keeps its own state (words.ts, phone.ts); nothing to send later.
    if (laptopBase() === undefined) return {};
    saveOutbox([...outbox(), { method, path, body }]);
    return { queued: true };
  }
}

let flushing = false;
/** Sends what waited in the outbox. Called whenever the laptop answers. */
export async function flushOutbox(): Promise<void> {
  if (flushing || !outbox().length) return;
  flushing = true;
  try {
    for (const item of outbox()) {
      try {
        await request(item.method, item.path, item.body);
      } catch (e) {
        if (e instanceof OfflineError) return;
        // rejected by the laptop (e.g. the moment is gone): drop it
      }
      saveOutbox(outbox().slice(1));
    }
  } finally {
    flushing = false;
  }
}

const at = (path: string) => `${laptopBase() ?? ''}${path}`;
export const audioUrl = (id: string) => (isLocalMoment(id) ? localMediaUrl(id) : at(`/api/moments/${id}/audio`));
export const imageUrl = (id: string) => at(`/api/moments/${id}/image`);

const mediaOf = (moments: Moment[]) => moments.flatMap((m) => [...(m.hasAudio ? [audioUrl(m.id)] : []), ...(m.hasImage ? [imageUrl(m.id)] : [])]);
/** Laptop list plus what the phone marked on its own and has not handed over yet. */
async function withLocal(load: () => Promise<Moment[]>, inbox = false): Promise<Moment[]> {
  const local = localMoments().filter((m) => !inbox || m.status === 'ready');
  const remote = await load().catch((e: Error) => {
    if (local.length) return []; // the phone's own marks still show when the laptop is away or fails
    throw e;
  });
  const ids = new Set(local.map((m) => m.id));
  return [...local, ...remote.filter((m) => !ids.has(m.id))];
}

/** Phone marks go to the laptop first; Claude, Anki and Whisper only run there. */
async function handOver(id: string): Promise<void> {
  if (!isLocalMoment(id)) return;
  const away = new OfflineError('This needs the laptop. The mark moves there as soon as it is reachable.');
  if (reachable === false) throw away;
  try {
    await syncPhone();
  } catch {
    throw away;
  }
}

const findMoment = async (id: string) =>
  [...((await recall<Moment[]>('inbox'))?.value ?? []), ...((await recall<Moment[]>('moments'))?.value ?? [])].find((m) => m.id === id);

export const api = {
  status: () =>
    request<Status>('GET', '/api/status', undefined, {}, 5000).then(
      (s) => ((reachable = true), (cardsHere = s.cards !== false), seenLaptop(s.version), s),
      (e: Error) => {
        if (e instanceof OfflineError) reachable = false;
        throw e;
      },
    ),
  settings: () => mirrored('settings', () => request<Settings>('GET', '/api/settings')),
  saveSettings: (s: Partial<Settings>) => request('PUT', '/api/settings', s),

  searchJimaku: (q: string) => request<JimakuEntry[]>('GET', `/api/jimaku/search?q=${encodeURIComponent(q)}`),
  jimakuFiles: (id: number, episode: number) => request<JimakuFile[]>('GET', `/api/jimaku/entries/${id}/files?episode=${episode}`),
  recentSessions: () => mirrored('sessions', () => request<(Session & { nextEpisode: number })[]>('GET', '/api/sessions/recent')),
  startSession: (body: { title: string; jimakuEntryId?: number; anilistId?: number; episode: number; fileUrl?: string; fileName?: string }) =>
    request<{ session: Session; warning?: string }>('POST', '/api/sessions', body, {}, SLOW),
  photoText: (file: Blob) => request<{ blocks: { text: string }[] }>('POST', '/api/screen?inbox=0', file, { 'Content-Type': 'application/octet-stream' }, SLOW),
  /** Like photoText, with the size of the photo and where each line is (for the camera) */
  photoRead: (file: Blob) =>
    request<{ w: number; h: number; whole?: boolean; blocks: { text: string; box: [number, number, number, number] }[] }>(
      'POST',
      '/api/screen?inbox=0&whole=1',
      file,
      { 'Content-Type': 'application/octet-stream' },
      SLOW,
    ),
  /** The text in a region the user framed on a photo (photo pixels), read without looking for text first */
  photoRegion: (file: Blob, box: number[]) =>
    request<{ text: string }>('POST', `/api/screen/region?box=${box.map((v) => Math.round(v)).join(',')}`, file, { 'Content-Type': 'application/octet-stream' }, SLOW),
  cameraMine: (body: { image?: string; text: string; targetHint?: string; box?: number[]; w: number; h: number }) => request<Moment>('POST', '/api/screen/mine', body, {}, SLOW),
  hookLines: (after: number) => request<{ connected: boolean; url: string; lines: { id: number; text: string; at: string }[] }>('GET', `/api/hook/lines?after=${after}`),
  transcribeAudio: (file: File) =>
    request<{ id: string }>('POST', '/api/text/transcribe', file, { 'x-filename': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' }, 600_000),
  transcription: (id: string) => request<{ state: 'working' | 'done' | 'error'; cues?: Cue[]; error?: string }>('GET', `/api/text/transcribe/${id}`),
  uploadSubtitles: (sessionId: string, file: File) =>
    request<{ session: Session }>('POST', `/api/sessions/${sessionId}/subtitles`, file, { 'x-filename': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' }, SLOW),
  cues: async (sessionId: string, from: number, to: number) => {
    const local = isPhoneSession(sessionId) ? await sessionCues(sessionId) : [];
    if (local.length) return local.filter((c) => c.end >= from && c.start <= to);
    return request<Cue[]>('GET', `/api/sessions/${sessionId}/cues?from=${from}&to=${to}`);
  },
  endSession: () => request('POST', '/api/sessions/end'),
  /** Presses Alt+Shift+H in Chrome on the laptop (Windows): starts or stops the extension's recording. */
  startRecording: () => request<{ recording: boolean; error?: string }>('POST', '/api/recording/start', undefined, {}, 30_000),
  stopRecording: () => request<{ recording: boolean; error?: string }>('POST', '/api/recording/stop', undefined, {}, 30_000),

  mark: () => request<Moment>('POST', '/api/mark'),
  undo: () => request<{ removed: Moment | null }>('POST', '/api/undo'),

  inbox: () =>
    withLocal(() =>
      mirrored('inbox', async () => {
        const list = await request<Moment[]>('GET', '/api/inbox');
        void mirrorMedia(mediaOf(list));
        return list;
      }),
      true,
    ),
  moments: (limit = 200) => withLocal(() => mirrored('moments', () => request<Moment[]>('GET', `/api/moments?limit=${limit}`))),
  moment: async (id: string) =>
    localMoments().find((m) => m.id === id) ?? mirrored(`moment:${id}`, () => request<Moment>('GET', `/api/moments/${id}`), () => findMoment(id)),
  createCard: async (id: string, req: CardRequest & { skipAi?: boolean }) => {
    await handOver(id);
    return request('POST', `/api/moments/${id}/card`, req, {}, SLOW);
  },
  discard: async (id: string) => {
    if (isLocalMoment(id)) return dropLocal(id);
    const { queued } = await orLater('POST', `/api/moments/${id}/discard`);
    if (queued) await patchMirror<Moment[]>('inbox', (list) => list.filter((m) => m.id !== id));
  },
  /** The phone made the card itself: the moment leaves the inbox here and on the laptop. */
  cardDone: async (id: string, card: { cardSentence: string; cardTarget: string }) => {
    if (isLocalMoment(id)) return markLocalDone(id, card);
    await orLater('POST', `/api/moments/${id}/done`, card);
    await patchMirror<Moment[]>('inbox', (list) => list.filter((m) => m.id !== id));
    await patchMirror<Moment>(`moment:${id}`, (m) => ({ ...m, status: 'done', ...card }));
  },
  ankiNoteType: () => request<{ id?: number; deck: string }>('GET', '/api/anki/notetype', undefined, {}, 20_000),
  hasCards: (words: string[]) => request<{ existing: string[] }>('POST', '/api/anki/has-cards', { words }).then((r) => r.existing),
  translate: (input: TranslateInput & { fresh?: boolean }) => request<Translation>('POST', '/api/translate', input, {}, SLOW),
  /** Marks a laptop answer good (1) or poor (-1) in its AI log */
  rateAnswer: (ref: string, rating: 1 | -1) => request('POST', '/api/ai/rate', { ref, rating }),
  /** Hands the laptop an answer this phone got from its own key, for its AI log (kept for later when it is away) */
  recordAnswer: (body: { kind: 'explain' | 'translate'; engine: string; model: string; profile: string; input: unknown; output: unknown }) => orLater('POST', '/api/ai/record', body),
  /** The kanji collection: quiz progress (the laptop keeps a copy) */
  kanjiSkill: () => request<import('../../../shared/kanjiSkill.ts').SkillMap>('GET', '/api/kanji/skill'),
  putKanjiSkill: (skill: import('../../../shared/kanjiSkill.ts').SkillMap) => request<import('../../../shared/kanjiSkill.ts').SkillMap>('PUT', '/api/kanji/skill', skill),
  /** Settings → Check everything */
  doctor: () => request<{ name: string; state: 'ok' | 'warn' | 'bad'; detail: string; fix?: string }[]>('GET', '/api/doctor', undefined, {}, 30_000),
  aiStats: () => request<{ count: number; good: number; bad: number }>('GET', '/api/ai/stats'),
  /** The AI log as chat examples for training a model (JSON lines) */
  aiExamples: async (rated: boolean): Promise<Blob> => {
    const res = await fetch(laptopUrl(`/api/ai/examples${rated ? '?rated=1' : ''}`), { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  },
  restore: (id: string) => orLater('POST', `/api/moments/${id}/restore`),
  transcribe: async (id: string) => {
    await handOver(id);
    return request('POST', `/api/moments/${id}/transcribe`, undefined, {}, SLOW);
  },

  episodeInsight: (entryId: number, episode: number) =>
    mirrored(`episode:${entryId}:${episode}`, () =>
      request<EpisodeInsight>('GET', `/api/insights/episode?entryId=${entryId}&episode=${episode}`, undefined, {}, SLOW),
    ),
  known: (refresh = false) =>
    mirrored('known', () =>
      request<{ anki: number; manual: number; jlpt: number; total: number; ankiRefreshedAt?: string }>('GET', `/api/insights/known${refresh ? '?refresh=1' : ''}`, undefined, {}, SLOW),
    ),
  setStatus: (word: string, status: WordStatus | null) => orLater('POST', '/api/insights/status', { word, status }),
  words: () => mirrored('words', () => request<WordState>('GET', '/api/insights/words', undefined, {}, 30_000)),
  importKnown: (source: 'jpdb' | 'wanikani' | 'list', input: string) =>
    request<{ count: number }>('POST', '/api/insights/known/import', source === 'list' ? { source, text: input } : { source, key: input }, {}, SLOW),
  modules: () => request<{ whisper: boolean; manga: boolean; ocr: boolean; voice: boolean; claude: boolean; ollama: boolean }>('GET', '/api/modules', undefined, {}, 20_000),
  playerNow: () => request<{ player: string; title: string; episode?: number; position: number; duration?: number; playing: boolean } | null>('GET', '/api/player/now', undefined, {}, 8000),
  importLines: (text: string, name: string) => request<{ count: number }>('POST', '/api/text/import', { text, name }, {}, 60_000),
  fetchArticle: (url: string) => request<{ title: string; text: string }>('GET', `/api/text/fetch?url=${encodeURIComponent(url)}`, undefined, {}, 30_000),
  wordsRead: (day: string, words: number) => orLater('POST', '/api/text/read', { day, words }),
  dicts: () => request<DictInfo[]>('GET', '/api/dicts'),
  importDict: (file: File) => request<DictInfo>('POST', '/api/dicts', file, { 'Content-Type': 'application/octet-stream' }, 600_000),
  removeDict: (id: string) => request('DELETE', `/api/dicts/${encodeURIComponent(id)}`),
  dictLookup: (forms: string[]) => request<Record<string, DictHit>>('POST', '/api/dicts/lookup', { forms }, {}, 5000),
  analytics: () => mirrored('analytics', () => request<Analytics>('GET', '/api/analytics', undefined, {}, SLOW)),
  /** Re-reads the Anki review history; starts Anki if it is not running (can take a minute). */
  previewCards: (cards: { word: string; reading: string; meaning?: string; example?: string; source: string }[]) =>
    request<{ added: string[]; existing: string[] }>('POST', '/api/insights/preview-cards', { cards }, {}, SLOW),
  backups: () => request<{ days: string[]; keep: number }>('GET', '/api/backup'),
  restoreBackup: (day: string) => request('POST', '/api/backup/restore', { day }, {}, SLOW),
  backupNow: () => request<{ written: string[] }>('POST', '/api/backup', undefined, {}, SLOW),
  pushInfo: () => request<{ key: string; devices: number }>('GET', '/api/push'),
  pushSubscribe: (subscription: PushSubscriptionJSON) => request<{ devices: number }>('POST', '/api/push/subscribe', { subscription }),
  pushUnsubscribe: (endpoint: string) => request<{ devices: number }>('POST', '/api/push/unsubscribe', { endpoint }),
  pushTest: () => request<{ sent: number }>('POST', '/api/push/test'),
  refreshAnki: () => request<Analytics>('POST', '/api/analytics/anki', undefined, {}, SLOW),
};

export type WordStat = { word: string; reading: string; count: number; known: boolean; meaning?: string; example?: string; inAnki?: boolean };
export type EpisodeInsight = { coverage: number; tokens: number; uniqueWords: number; unknownWords: number; priming: WordStat[] };
