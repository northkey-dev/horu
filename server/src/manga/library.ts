import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, MANGA_DIR, safeId, writeJsonAtomic } from '../config.ts';
import { readJsonKeepingDamaged } from '../jsonFile.ts';
import type { Printed } from '../../../shared/readings.ts';

// Horu's own manga state: which manga are being read, reading progress and the
// chapters prepared (downloaded + OCR'd) for offline reading on the phone.
// Keys: manga "s<id>" (Suwayomi) or "i<id>" (import); chapters "c<id>" (Suwayomi) or "i<id>-<n>" (import).

export type ActiveManga = {
  key: string;
  title: string;
  source: string;
  addedAt: string;
  status: 'reading' | 'paused';
  hasThumb: boolean;
  description?: string;
  /** Reading position */
  chapterKey?: string;
  page?: number;
  lastReadAt?: string;
  chaptersRefreshedAt?: string;
  /** The source turned out to have Chinese text (see shared/lang.ts): no more chapters are prepared */
  notJapanese?: boolean;
};

/** paused: stopped by the user, pages so far kept; cancelled: stopped or deleted by the user, pages gone (not prepared again by itself) */
export type ChapterStatus = 'queued' | 'downloading' | 'ocr' | 'ready' | 'error' | 'paused' | 'cancelled';

export type PreparedChapter = {
  key: string;
  mangaKey: string;
  name: string;
  /** Reading order within the manga (ascending). */
  order: number;
  status: ChapterStatus;
  error?: string;
  pageCount: number;
  pagesDone: number;
  preparedAt?: string;
  readAt?: string;
  /** Text language checked after OCR; true = Chinese */
  chinese?: boolean;
  /** The text recognition runs again; the chapter stays readable meanwhile */
  rereading?: boolean;
  /** Pages read so far in that run; not set while it waits for its turn */
  rereadPages?: number;
};

export type PageBlock = { box: [number, number, number, number]; vertical: boolean; text: string; readings?: Printed[] };
export type ChapterPage = { file: string; w: number; h: number; blocks: PageBlock[] };
export type ChapterData = { key: string; mangaKey: string; mangaTitle: string; name: string; order: number; pages: ChapterPage[] };

type Db = { manga: ActiveManga[]; chapters: PreparedChapter[] };

const FILE = path.join(DATA_DIR, 'manga.json');
export const THUMB_DIR = path.join(MANGA_DIR, 'thumbs');
fs.mkdirSync(THUMB_DIR, { recursive: true });

const db = readJsonKeepingDamaged<Db>(FILE, () => ({ manga: [], chapters: [] }));

let timer: NodeJS.Timeout | undefined;
function save(): void {
  clearTimeout(timer);
  timer = setTimeout(() => writeJsonAtomic(FILE, db), 200);
}

export const chapterDir = (key: string) => path.join(MANGA_DIR, safeId(key));
export const thumbPath = (key: string) => path.join(THUMB_DIR, `${safeId(key)}.jpg`);

export function listManga(): ActiveManga[] {
  return db.manga;
}

export function getManga(key: string): ActiveManga | undefined {
  return db.manga.find((m) => m.key === key);
}

export function upsertManga(m: ActiveManga): ActiveManga {
  safeId(m.key);
  const existing = getManga(m.key);
  if (existing) Object.assign(existing, m);
  else db.manga.push(m);
  save();
  return getManga(m.key)!;
}

export function updateManga(key: string, patch: Partial<ActiveManga>): void {
  const m = getManga(key);
  if (!m) return;
  Object.assign(m, patch);
  save();
}

export function removeManga(key: string): void {
  db.manga = db.manga.filter((m) => m.key !== key);
  for (const c of db.chapters.filter((c) => c.mangaKey === key)) removeChapter(c.key);
  fs.rmSync(thumbPath(key), { force: true });
  save();
}

export function chaptersOf(mangaKey: string): PreparedChapter[] {
  return db.chapters.filter((c) => c.mangaKey === mangaKey).sort((a, b) => a.order - b.order);
}

export function getChapter(key: string): PreparedChapter | undefined {
  return db.chapters.find((c) => c.key === key);
}

export function upsertChapter(c: PreparedChapter): PreparedChapter {
  safeId(c.key);
  const existing = getChapter(c.key);
  if (existing) Object.assign(existing, c);
  else db.chapters.push(c);
  save();
  return getChapter(c.key)!;
}

export function updateChapter(key: string, patch: Partial<PreparedChapter>): void {
  const c = getChapter(key);
  if (!c) return;
  Object.assign(c, patch);
  save();
}

export function removeChapter(key: string): void {
  db.chapters = db.chapters.filter((c) => c.key !== key);
  fs.rmSync(chapterDir(key), { recursive: true, force: true });
  save();
}

/** Size of a chapter's files on disk. */
export function chapterBytes(key: string): number {
  try {
    return fs.readdirSync(chapterDir(key)).reduce((n, f) => n + fs.statSync(path.join(chapterDir(key), f)).size, 0);
  } catch {
    return 0;
  }
}

/** Deletes a chapter's pages but keeps its entry. */
export function clearChapterFiles(key: string): void {
  fs.rmSync(chapterDir(key), { recursive: true, force: true });
}

export function allChapters(): PreparedChapter[] {
  return db.chapters;
}

export function readChapterData(key: string): ChapterData | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(chapterDir(key), 'chapter.json'), 'utf8'));
  } catch {
    return undefined;
  }
}

export function writeChapterData(data: ChapterData): void {
  writeJsonAtomic(path.join(chapterDir(data.key), 'chapter.json'), data);
}
