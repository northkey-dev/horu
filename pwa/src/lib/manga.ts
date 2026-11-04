// Manga client: server API + offline storage (Cache Storage + localStorage) so
// prepared chapters can be read without the laptop.

import type { EpisodeInsight } from './api.ts';
import type { Printed } from '../../../shared/readings.ts';
import { laptopBase, laptopUrl } from './laptop.ts';
import { friendlyMangaError } from '../../../shared/mangaErrors.ts';

export type LibraryManga = {
  key: string;
  title: string;
  source: string;
  status: 'reading' | 'paused';
  hasThumb: boolean;
  description?: string;
  chapterKey?: string;
  page?: number;
  lastReadAt?: string;
  /** The text turned out to be Chinese: the laptop stopped preparing chapters */
  notJapanese?: boolean;
  ready: number;
  preparing: number;
  failed: number;
};

export type PreparedChapter = {
  key: string;
  mangaKey: string;
  name: string;
  order: number;
  status: 'queued' | 'downloading' | 'ocr' | 'ready' | 'error' | 'paused' | 'cancelled';
  error?: string;
  pageCount: number;
  pagesDone: number;
  preparedAt?: string;
  /** The laptop reads the text again; the chapter stays readable */
  rereading?: boolean;
  /** Pages read so far; not set while the chapter waits for its turn */
  rereadPages?: number;
  readAt?: string;
  chinese?: boolean;
};

export type PageBlock = { readings?: Printed[]; box: [number, number, number, number]; vertical: boolean; text: string };
export type ChapterData = {
  key: string;
  mangaKey: string;
  mangaTitle: string;
  name: string;
  order: number;
  pages: { file: string; w: number; h: number; blocks: PageBlock[] }[];
};

export type Extension = { pkgName: string; name: string; lang: string; isInstalled: boolean; hasUpdate: boolean; iconUrl: string; isNsfw?: boolean };
export type Source = { id: string; name: string; lang: string; displayName: string; iconUrl: string };
export type RemoteManga = { id: number; title: string; thumbnailUrl: string | null; inLibrary: boolean };
export type RemoteChapter = {
  id: number;
  key: string;
  name: string;
  chapterNumber: number;
  isRead: boolean;
  pageCount: number;
  prepared?: PreparedChapter;
};

type OfflineEntry = { key: string; mangaKey: string; name: string; order: number; preparedAt?: string; files: string[]; cachedAt: string; finishedAt?: string; pinned?: boolean };

const CACHE = 'horu-manga';
const INDEX_KEY = 'horu-offline-chapters';
const LIBRARY_KEY = 'horu-manga-library';
const PENDING_KEY = 'horu-pending';

// ---- tiny storage helpers (storage can be unavailable in private mode) ----

function readJson<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '') as T;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota or private mode
  }
}

// A switched-off laptop behind Tailscale never answers instead of refusing. Generous, because
// the first source search starts Suwayomi (Java), which takes a while.
const LAPTOP_WAIT = 90_000;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(laptopUrl(path), { credentials: 'same-origin', signal: AbortSignal.timeout(LAPTOP_WAIT) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ? friendlyMangaError(data.error) : `HTTP ${res.status}`);
  return data as T;
}

/** An error from a laptop call in words for the reader of the screen. */
export function describeError(e: unknown): string {
  const err = e as Error;
  if (err.name === 'TimeoutError') return 'The laptop took too long to answer. The source may be slow or blocked; try again.';
  if (err instanceof TypeError) return 'The laptop cannot be reached.';
  return err.message;
}
async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(laptopUrl(path), {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(LAPTOP_WAIT),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ? friendlyMangaError(data.error) : `HTTP ${res.status}`);
  return data as T;
}

export const mangaApi = {
  status: () => get<{ suwayomiInstalled: boolean; ocrAvailable: boolean }>('/api/manga/status'),
  extensions: () => get<Extension[]>('/api/manga/extensions?lang=ja'),
  setExtension: (pkg: string, install: boolean) => send('POST', `/api/manga/extensions/${encodeURIComponent(pkg)}`, { install }),
  sources: () => get<Source[]>('/api/manga/sources'),
  search: (source: string, q: string, page = 1) =>
    get<{ mangas: RemoteManga[]; hasNextPage: boolean }>(`/api/manga/search?source=${source}&q=${encodeURIComponent(q)}&page=${page}`),
  remote: (id: number, refresh = false) =>
    get<{ manga: RemoteManga & { key: string; description: string | null; author: string | null; active?: LibraryManga }; chapters: RemoteChapter[] }>(
      `/api/manga/remote/${id}${refresh ? '?refresh=1' : ''}`,
    ),
  library: async () => {
    const lib = await get<LibraryManga[]>('/api/manga/library');
    writeJson(LIBRARY_KEY, lib);
    return lib;
  },
  cachedLibrary: () => readJson<LibraryManga[]>(LIBRARY_KEY, []),
  addToLibrary: (mangaId: number, chapterKey?: string) => send<LibraryManga>('POST', '/api/manga/library', { mangaId, chapterKey }),
  setStatus: (key: string, status: 'reading' | 'paused') => send<LibraryManga>('PATCH', `/api/manga/library/${key}`, { status }),
  remove: (key: string) => send('DELETE', `/api/manga/library/${key}`),
  chapterInsight: (key: string) => get<EpisodeInsight>(`/api/manga/chapters/${key}/insight`),
  chapters: (key: string) => get<PreparedChapter[]>(`/api/manga/library/${key}/chapters`),
  prepare: (key: string, mangaKey: string, name: string, order: number) =>
    send<PreparedChapter>('POST', `/api/manga/chapters/${key}/prepare`, { mangaKey, name, order }),
  chapter: (key: string) => get<{ chapter: PreparedChapter; data?: ChapterData }>(`/api/manga/chapters/${key}`),
  /** pause keeps the pages so far; cancel removes them (on a ready chapter: deletes it, also from this phone) */
  stopChapter: async (key: string, how: 'pause' | 'cancel') => {
    const c = await send<PreparedChapter>('POST', `/api/manga/chapters/${key}/${how}`);
    if (how === 'cancel') await removeOfflineChapter(key);
    return c;
  },
  markRead: (key: string, read: boolean) => send<PreparedChapter>('POST', `/api/manga/chapters/${key}/read`, { read }),
  storage: () => get<{ bytes: number; chapters: number; readBytes: number; readChapters: number }>('/api/manga/storage'),
  /** Deletes all read chapters on the laptop and the phone's copies of them; returns the bytes freed on the laptop. */
  freeReadChapters: async () => {
    const { keys, freed } = await send<{ keys: string[]; freed: number }>('POST', '/api/manga/cleanup');
    const index = offlineIndex();
    for (const key of Object.keys(index)) if (keys.includes(key) || index[key].finishedAt) await removeOfflineChapter(key);
    return freed;
  },
  resumeChapter: (key: string) => send<PreparedChapter>('POST', `/api/manga/chapters/${key}/resume`),
  rereadChapter: (key: string) => send<PreparedChapter>('POST', `/api/manga/chapters/${key}/reread`),
  rereadManga: (key: string) => send<PreparedChapter[]>('POST', `/api/manga/library/${key}/reread`),
  pauseDownloads: (mangaKey: string, pause: boolean) => send<PreparedChapter[]>('POST', `/api/manga/library/${mangaKey}/downloads`, { pause }),
  serverSearch: (q: string) => get<{ id: string; name: string; books?: number }[]>(`/api/manga/server/search?q=${encodeURIComponent(q)}`),
  serverBooks: (id: string) => get<{ id: string; name: string }[]>(`/api/manga/server/series/${encodeURIComponent(id)}`),
  serverImport: (seriesId: string, seriesName: string, bookId: string, bookName: string) =>
    send<LibraryManga>('POST', '/api/manga/server/import', { seriesId, seriesName, bookId, bookName }),
  importFile: async (file: File) => {
    const res = await fetch(laptopUrl('/api/manga/import'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'x-filename': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data as LibraryManga;
  },
};

export const fileUrl = (chapterKey: string, file: string) => `${laptopBase() ?? ''}/api/manga/files/${chapterKey}/${file}`;
export const thumbUrl = (mangaKey: string) => `${laptopBase() ?? ''}/api/manga/thumb/${mangaKey}`;
export const remoteThumbUrl = (id: number) => `${laptopBase() ?? ''}/api/manga/remote/${id}/thumb`;

// ---- offline chapters ----

export function offlineIndex(): Record<string, OfflineEntry> {
  return readJson<Record<string, OfflineEntry>>(INDEX_KEY, {});
}

export function offlineChaptersOf(mangaKey: string): OfflineEntry[] {
  return Object.values(offlineIndex())
    .filter((c) => c.mangaKey === mangaKey)
    .sort((a, b) => a.order - b.order);
}

/** Cache Storage exists (it needs https, which the hosted app and the Tailscale address have). */
export const canCache = () => typeof caches !== 'undefined';

/** Chapter data from the offline cache, falling back to the laptop. */
export async function loadChapter(key: string): Promise<ChapterData> {
  if (canCache()) {
    const hit = await (await caches.open(CACHE)).match(`/offline/chapter/${key}.json`);
    if (hit) return hit.json();
  }
  const { chapter, data } = await mangaApi.chapter(key);
  if (!data)
    throw new Error(
      chapter.status === 'error' ? chapter.error ?? 'Failed' : chapter.status === 'cancelled' ? 'This chapter was deleted. Download it again from the chapter list.' : 'Chapter is still being prepared',
    );
  return data;
}

export type SyncProgress = { done: number; total: number; current?: string };

/**
 * Downloads every prepared chapter of the manga being read into Cache Storage
 * and drops chapters the laptop no longer offers (read long ago / paused). `signal` stops it between
 * pages; chapters saved so far stay and the next sync carries on with the rest.
 */
export async function syncOffline(onProgress?: (p: SyncProgress) => void, keepReadDays = 3, signal?: AbortSignal): Promise<{ added: number; removed: number }> {
  if (!canCache()) throw new Error('Offline storage needs the https (Tailscale) address.');
  await flushPending();
  const manifest = await get<(Omit<OfflineEntry, 'cachedAt'> & { files: string[] })[]>('/api/manga/offline');
  await mangaApi.library().catch(() => undefined);
  const cache = await caches.open(CACHE);
  const index = offlineIndex();
  const wanted = new Set(manifest.map((c) => c.key));
  let removed = 0;
  for (const entry of Object.values(index)) {
    const finishedLongAgo = entry.finishedAt && Date.now() - Date.parse(entry.finishedAt) > keepReadDays * 86400_000;
    // Chapters saved by hand stay until they are removed by hand.
    if (!entry.pinned && (!wanted.has(entry.key) || finishedLongAgo)) {
      await removeOffline(cache, entry);
      delete index[entry.key];
      removed++;
    }
  }
  const todo = manifest.filter((c) => !index[c.key] || index[c.key].preparedAt !== c.preparedAt);
  const total = todo.reduce((n, c) => n + c.files.length + 1, 0);
  let done = 0;
  for (const c of todo) {
    onProgress?.({ done, total, current: c.name });
    signal?.throwIfAborted();
    const saved = await cacheChapter(cache, c, () => {
      done++;
      onProgress?.({ done, total, current: c.name });
    }, signal);
    if (!saved) continue;
    index[c.key] = { ...c, cachedAt: new Date().toISOString(), finishedAt: index[c.key]?.finishedAt, pinned: index[c.key]?.pinned };
    writeJson(INDEX_KEY, index);
  }
  for (const m of mangaApi.cachedLibrary()) {
    const url = thumbUrl(m.key);
    if (m.hasThumb && !(await cache.match(url))) {
      const res = await fetch(url, { credentials: 'same-origin', signal: AbortSignal.timeout(LAPTOP_WAIT) }).catch(() => undefined);
      if (res?.ok) await cache.put(url, res);
    }
  }
  writeJson(INDEX_KEY, index);
  onProgress?.({ done: total, total });
  return { added: todo.length, removed };
}

/** Pages and text of one chapter into Cache Storage; false when the laptop has no prepared data for it. */
async function cacheChapter(cache: Cache, c: { key: string; files: string[] }, tick: () => void, signal?: AbortSignal): Promise<boolean> {
  const data = await get<{ data?: ChapterData }>(`/api/manga/chapters/${c.key}`);
  if (!data.data) return false;
  for (const file of c.files) {
    signal?.throwIfAborted();
    const url = fileUrl(c.key, file);
    if (!(await cache.match(url))) {
      const res = await fetch(url, { credentials: 'same-origin', signal: AbortSignal.timeout(LAPTOP_WAIT) });
      if (res.ok) await cache.put(url, res);
    }
    tick();
  }
  await cache.put(`/offline/chapter/${c.key}.json`, new Response(JSON.stringify(data.data), { headers: { 'Content-Type': 'application/json' } }));
  tick();
  return true;
}

/**
 * Saves one chapter on this phone, so its pages open without waiting for the laptop (and without it).
 * It stays until it is removed by hand. `onProgress` gets the share done, 0 to 1.
 */
export async function saveChapterOffline(key: string, onProgress?: (share: number) => void): Promise<void> {
  if (!canCache()) throw new Error('Saving on the phone needs the https address (the hosted app or Tailscale).');
  const { chapter, data } = await mangaApi.chapter(key);
  if (!data) throw new Error('This chapter is not prepared yet');
  const files = data.pages.map((p) => p.file);
  const total = files.length + 1;
  let done = 0;
  const cache = await caches.open(CACHE);
  if (!(await cacheChapter(cache, { key, files }, () => onProgress?.(++done / total)))) throw new Error('This chapter is not prepared yet');
  const index = offlineIndex();
  index[key] = {
    key,
    mangaKey: chapter.mangaKey,
    name: chapter.name,
    order: chapter.order,
    preparedAt: chapter.preparedAt,
    files,
    cachedAt: new Date().toISOString(),
    finishedAt: index[key]?.finishedAt,
    pinned: true,
  };
  writeJson(INDEX_KEY, index);
}

/** Removes a chapter's offline copy from this phone. */
export async function removeOfflineChapter(key: string): Promise<void> {
  const index = offlineIndex();
  if (!index[key] || !canCache()) return;
  await removeOffline(await caches.open(CACHE), index[key]);
  delete index[key];
  writeJson(INDEX_KEY, index);
}

async function removeOffline(cache: Cache, entry: OfflineEntry): Promise<void> {
  await cache.delete(`/offline/chapter/${entry.key}.json`);
  for (const f of entry.files) await cache.delete(fileUrl(entry.key, f));
}

export function markFinishedOffline(key: string): void {
  const index = offlineIndex();
  if (index[key] && !index[key].finishedAt) {
    index[key].finishedAt = new Date().toISOString();
    writeJson(INDEX_KEY, index);
  }
}

// ---- progress & mining, queued while offline ----

type Pending = { kind: 'progress' | 'mine'; body: Record<string, unknown> };

export function pendingCount(): number {
  return readJson<Pending[]>(PENDING_KEY, []).length;
}

function queue(item: Pending): void {
  const list = readJson<Pending[]>(PENDING_KEY, []);
  // Only the newest progress per manga matters.
  const filtered = item.kind === 'progress' ? list.filter((p) => !(p.kind === 'progress' && p.body.mangaKey === item.body.mangaKey)) : list;
  writeJson(PENDING_KEY, [...filtered, item]);
}

export async function flushPending(): Promise<number> {
  const list = readJson<Pending[]>(PENDING_KEY, []);
  const rest: Pending[] = [];
  let sent = 0;
  for (const item of list) {
    try {
      await send('POST', item.kind === 'progress' ? '/api/manga/progress' : '/api/manga/mine', item.body);
      sent++;
    } catch (err) {
      // Laptop offline: keep for later. Server rejected: drop it.
      if (err instanceof TypeError) rest.push(item);
    }
  }
  writeJson(PENDING_KEY, rest);
  return sent;
}

export async function reportProgress(body: { mangaKey: string; chapterKey: string; page: number; finished?: boolean }): Promise<void> {
  const full = { ...body, at: new Date().toISOString() };
  if (body.finished) markFinishedOffline(body.chapterKey);
  queue({ kind: 'progress', body: full });
  await flushPending().catch(() => 0);
}

/** Returns true when it reached the inbox right away, false when it is queued. */
export async function mineLine(body: { readings?: Printed[]; mangaKey: string; chapterKey: string; page: number; block?: number; text: string; targetHint?: string }): Promise<boolean> {
  try {
    await send('POST', '/api/manga/mine', { ...body, at: new Date().toISOString() });
    return true;
  } catch (err) {
    if (!(err instanceof TypeError)) throw err;
    queue({ kind: 'mine', body: { ...body, at: new Date().toISOString() } });
    return false;
  }
}
