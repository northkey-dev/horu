import { loadKanjidic } from '../kanji.ts';
import { lookupIndex } from '../dict.ts';
import { tokenizer } from '../japanese.ts';
import { realWords, trustedPrinted } from '../../../shared/readings.ts';
import fs from 'node:fs';
import path from 'node:path';
import { getSettings } from '../config.ts';
import { looksChinese, looksJapanese } from '../../../shared/lang.ts';
import { clampFrame, keepFramed } from '../../../shared/frames.ts';
import { friendlyMangaError } from '../../../shared/mangaErrors.ts';
import { log } from '../log.ts';
import { PyWorker } from '../pyworker.ts';
import * as lib from './library.ts';
import * as suwa from './suwayomi.ts';

// Background preparation of manga chapters: download pages through Suwayomi,
// run OCR on every page and store the result for the phone. Also keeps the
// "next N chapters" window filled for every manga marked as reading.

const ocr = new PyWorker('ocr', 'ocr_worker.py', () => [], 5 * 60_000);
type Furigana = { base: string; ruby: string }[];
type OcrPage = { page: { img_width: number; img_height: number; blocks: { box: number[]; vertical: boolean; lines: string[]; furigana?: Furigana }[] } };

export function ocrAvailable(): boolean {
  return ocr.available();
}

/**
 * OCR of a single image (iPhone screenshots, photos). Blocks in reading order. With `photo` the text is found by
 * a detector made for photos (EasyOCR's CRAFT) when it is installed; manga pages and screenshots keep the manga one.
 */
export async function ocrImage(file: string, photo = false): Promise<{ w: number; h: number; blocks: lib.PageBlock[] }> {
  const res = await ocr.request<OcrPage>({ file, photo });
  const blocks = res.page.blocks
    .map((b) => ({ box: b.box.slice(0, 4) as [number, number, number, number], vertical: b.vertical, text: b.lines.join('') }))
    .filter((b) => b.text.trim());
  const vertical = blocks.filter((b) => b.vertical).length > blocks.length / 2;
  // Vertical text reads right-to-left, horizontal top-to-bottom.
  blocks.sort((a, b) => (vertical ? b.box[2] - a.box[2] || a.box[1] - b.box[1] : a.box[1] - b.box[1] || a.box[0] - b.box[0]));
  return { w: res.page.img_width, h: res.page.img_height, blocks };
}

/** Reads one framed region of an image (a word, a single character, handwriting) without looking for text first. */
export async function ocrRegion(file: string, box: number[]): Promise<string> {
  const res = await ocr.request<{ text: string }>({ file, region: box.map((v) => Math.round(v)) });
  return res.text.trim();
}

const EXT_BY_TYPE: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };

// ---- queue ----

const queue: string[] = [];
let running: string | undefined;
let draining = false;
/** Stop requests for the chapter being prepared, honoured after the current page. */
const stops = new Map<string, 'pause' | 'cancel'>();

class Stopped extends Error {}

export function enqueue(key: string, urgent = false): void {
  const idx = queue.indexOf(key);
  if (idx >= 0) {
    if (!urgent) return;
    queue.splice(idx, 1);
  }
  if (urgent) queue.unshift(key);
  else queue.push(key);
  void drain();
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      const key = queue.shift()!;
      const chapter = lib.getChapter(key);
      if (!chapter || chapter.status === 'ready' || chapter.status === 'paused' || chapter.status === 'cancelled') continue;
      running = key;
      try {
        await prepare(chapter);
      } catch (err) {
        if (err instanceof Stopped) stopped(key, stops.get(key)!);
        else {
          log.warn(`Preparing ${key} failed`, err);
          lib.updateChapter(key, { status: 'error', error: friendlyMangaError((err as Error).message) });
        }
      } finally {
        running = undefined;
        stops.delete(key);
      }
    }
  } finally {
    draining = false;
  }
}

function stopped(key: string, how: 'pause' | 'cancel'): void {
  // Imported chapters cannot be downloaded again: cancelling one removes it altogether.
  if (how === 'cancel' && !key.startsWith('c')) return lib.removeChapter(key);
  if (how === 'cancel') lib.clearChapterFiles(key);
  lib.updateChapter(key, how === 'pause' ? { status: 'paused' } : { status: 'cancelled', pagesDone: 0, error: undefined });
}

function checkStop(key: string): void {
  if (stops.has(key)) throw new Stopped();
}

/** Pause keeps the pages downloaded so far; cancel (also for a ready chapter: delete) removes them. */
export function stopChapter(key: string, how: 'pause' | 'cancel'): void {
  const chapter = lib.getChapter(key);
  if (!chapter) return;
  if (running === key) return void stops.set(key, how);
  const idx = queue.indexOf(key);
  if (idx >= 0) queue.splice(idx, 1);
  if (how === 'pause' && (chapter.status === 'ready' || chapter.status === 'cancelled')) return;
  stopped(key, how);
}

export function resumeChapter(key: string): void {
  const chapter = lib.getChapter(key);
  if (!chapter || chapter.status === 'ready') return;
  if (running === key) return void stops.delete(key);
  lib.updateChapter(key, { status: 'queued', error: undefined });
  enqueue(key, true);
}

/** Pause or resume every chapter of a manga that is not ready yet. */
export function pauseManga(mangaKey: string, pause: boolean): void {
  for (const c of lib.chaptersOf(mangaKey)) {
    if (pause && ['queued', 'downloading', 'ocr', 'error'].includes(c.status)) stopChapter(c.key, 'pause');
    if (!pause && c.status === 'paused') resumeChapter(c.key);
  }
}

/** Turns the furigana read off a page into the readings worth keeping for a text. */
async function printedReadings() {
  const dic = await loadKanjidic().catch(() => ({}));
  const index = lookupIndex();
  const known = (word: string) => index?.get(word)?.flatMap((e) => e[1].split('|')) ?? [];
  const tokens = await tokenizer();
  return (text: string, furigana: Furigana = []) => realWords(trustedPrinted(furigana, dic, known), tokens.tokenize(text), known);
}

async function chapterPage(file: string, res: OcrPage): Promise<lib.ChapterPage> {
  const readingsOf = await printedReadings();
  return {
    file,
    w: res.page.img_width,
    h: res.page.img_height,
    blocks: res.page.blocks
      .map((b) => {
        const text = b.lines.join('');
        const readings = readingsOf(text, b.furigana);
        return { box: b.box.slice(0, 4) as [number, number, number, number], vertical: b.vertical, text, ...(readings.length ? { readings } : {}) };
      })
      .filter((b) => b.text.trim()),
  };
}

// ---- reading one speech bubble again, in a frame set by hand ----

const GONE = 'This speech bubble is no longer there. Open the chapter again.';

/** Reads what the frame holds and puts it in place of the bubble. A frame without Japanese text changes nothing. */
export async function readFrame(key: string, pageIndex: number, blockIndex: number, box: unknown): Promise<lib.PageBlock> {
  const page = lib.readChapterData(key)?.pages[pageIndex];
  if (!page?.blocks[blockIndex]) throw new Error(GONE);
  if (!ocr.available()) throw new Error('Text recognition is not installed on the laptop.');
  const frame = clampFrame(box, page.w, page.h);
  if (!frame) throw new Error('Frame the text first.');
  const { framed } = await ocr.request<{ framed: { text: string; vertical: boolean; furigana: Furigana } }>({ file: path.join(lib.chapterDir(key), page.file), frame });
  const text = framed.text.trim();
  if (!looksJapanese(text)) throw new Error('No Japanese text found in this frame. Make it a little larger and try again.');
  const readings = (await printedReadings())(text, framed.furigana);
  // Loaded again: the chapter may have changed during the wait.
  const data = lib.readChapterData(key);
  const blocks = data?.pages[pageIndex]?.blocks;
  if (!data || !blocks?.[blockIndex]) throw new Error(GONE);
  const block: lib.PageBlock = { box: frame, vertical: framed.vertical, text, framed: true, ...(readings.length ? { readings } : {}) };
  blocks[blockIndex] = block;
  lib.writeChapterData(data);
  // A new date, so a phone with this chapter saved fetches the new text with its next sync.
  lib.updateChapter(key, { preparedAt: new Date().toISOString() });
  return block;
}

// ---- reading a finished chapter again (a better text recognition) ----

const toReread: string[] = [];
let rereading = false;

/** Queues a chapter. It stays readable: the new text replaces the old one when the whole chapter is through. */
export function rereadChapter(key: string): void {
  if (lib.getChapter(key)?.status !== 'ready') throw new Error('Only finished chapters can be read again');
  if (!ocr.available()) throw new Error('Text recognition is not installed on the laptop.');
  lib.updateChapter(key, { rereading: true, rereadPages: undefined });
  if (!toReread.includes(key)) toReread.push(key);
  void drainRereads();
}

async function drainRereads(): Promise<void> {
  if (rereading) return;
  rereading = true;
  try {
    while (toReread.length) {
      const key = toReread.shift()!;
      try {
        const data = lib.readChapterData(key);
        if (!data) continue; // deleted in the meantime
        const pages: lib.ChapterPage[] = [];
        lib.updateChapter(key, { rereadPages: 0 });
        for (const page of data.pages) {
          pages.push(await chapterPage(page.file, await ocr.request<OcrPage>({ file: path.join(lib.chapterDir(key), page.file) })));
          lib.updateChapter(key, { rereadPages: pages.length });
        }
        // Bubbles framed by hand stay, also those framed while this ran.
        const now = lib.readChapterData(key) ?? data;
        lib.writeChapterData({ ...data, pages: pages.map((p, i) => ({ ...p, blocks: keepFramed(now.pages[i]?.blocks ?? [], p.blocks) })) });
        // A new date, so a phone with this chapter saved fetches the new text with its next sync.
        lib.updateChapter(key, { preparedAt: new Date().toISOString() });
        log.info(`Read again: ${data.mangaTitle} / ${data.name}`);
      } catch (err) {
        log.warn(`Reading ${key} again failed`, err);
      } finally {
        lib.updateChapter(key, { rereading: undefined, rereadPages: undefined });
      }
    }
  } finally {
    rereading = false;
  }
}

async function prepare(chapter: lib.PreparedChapter): Promise<void> {
  const dir = lib.chapterDir(chapter.key);
  fs.mkdirSync(dir, { recursive: true });
  let files: string[];

  if (chapter.key.startsWith('c')) {
    lib.updateChapter(chapter.key, { status: 'downloading', error: undefined, pagesDone: 0 });
    const urls = await suwa.chapterPages(Number(chapter.key.slice(1)));
    lib.updateChapter(chapter.key, { pageCount: urls.length });
    files = [];
    // Pages kept from a paused run are not downloaded again.
    const have = fs.readdirSync(dir);
    for (let i = 0; i < urls.length; i++) {
      checkStop(chapter.key);
      const name = String(i).padStart(3, '0');
      let file = have.find((f) => f.startsWith(`${name}.`) && !f.endsWith('.tmp'));
      if (!file) {
        const { bytes, type } = await suwa.fetchBinary(urls[i]);
        file = `${name}.${EXT_BY_TYPE[type.split(';')[0]] ?? 'jpg'}`;
        fs.writeFileSync(path.join(dir, file), bytes);
      }
      files.push(file);
      lib.updateChapter(chapter.key, { pagesDone: i + 1 });
    }
  } else {
    // Imported chapters already have their pages on disk.
    files = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|webp|gif|avif)$/i.test(f)).sort();
  }

  lib.updateChapter(chapter.key, { status: 'ocr', pagesDone: 0, pageCount: files.length });
  const manga = lib.getManga(chapter.mangaKey);
  const pages: lib.ChapterPage[] = [];
  for (let i = 0; i < files.length; i++) {
    checkStop(chapter.key);
    let page: lib.ChapterPage = { file: files[i], w: 0, h: 0, blocks: [] };
    if (ocr.available()) {
      // shrink: colour scans are often saved at a needlessly high JPEG quality; smaller pages turn faster on the phone.
      page = await chapterPage(files[i], await ocr.request<OcrPage>({ file: path.join(dir, files[i]), shrink: true }));
    }
    pages.push(page);
    lib.updateChapter(chapter.key, { pagesDone: i + 1 });
  }
  lib.writeChapterData({ key: chapter.key, mangaKey: chapter.mangaKey, mangaTitle: manga?.title ?? '', name: chapter.name, order: chapter.order, pages });
  const chinese = looksChinese(pages.flatMap((p) => p.blocks.map((b) => b.text))) === true;
  lib.updateChapter(chapter.key, {
    status: 'ready',
    preparedAt: new Date().toISOString(),
    error: ocr.available() ? undefined : 'Text recognition is not installed – pages only.',
    chinese,
  });
  if (chinese) markNotJapanese(chapter.mangaKey);
  log.info(`Chapter ready: ${manga?.title} / ${chapter.name} (${pages.length} pages)`);
}

/** A source with Chinese text: stop preparing its chapters and drop the ones still waiting. */
function markNotJapanese(mangaKey: string): void {
  const manga = lib.getManga(mangaKey);
  if (!manga || manga.notJapanese) return;
  log.warn(`${manga.title}: the text is Chinese, not Japanese – no more chapters are prepared`);
  lib.updateManga(mangaKey, { notJapanese: true });
  for (const c of lib.chaptersOf(mangaKey)) {
    if (c.status === 'queued' || c.status === 'error') {
      lib.removeChapter(c.key);
      const i = queue.indexOf(c.key);
      if (i >= 0) queue.splice(i, 1);
    }
  }
}

// ---- reading window ----

export function sortChapters<T extends { chapterNumber: number; sourceOrder: number }>(chapters: T[]): T[] {
  return chapters.slice().sort((a, b) => a.chapterNumber - b.chapterNumber || a.sourceOrder - b.sourceOrder);
}

const REFRESH_MS = 6 * 3600_000;

/** Fills the next-N window of every manga being read and removes old read chapters. */
export async function syncWindows(): Promise<void> {
  const { mangaPrefetchChapters, mangaKeepReadDays: keepDays } = getSettings();
  const ahead = Math.max(1, Math.round(mangaPrefetchChapters) || 1);
  const keepMs = keepDays * 86400_000;
  for (const manga of lib.listManga()) {
    if (manga.status !== 'reading' || manga.notJapanese) continue;
    try {
      if (manga.key.startsWith('s')) {
        const refresh = !manga.chaptersRefreshedAt || Date.now() - Date.parse(manga.chaptersRefreshedAt) > REFRESH_MS;
        const { chapters } = await suwa.mangaWithChapters(Number(manga.key.slice(1)), refresh);
        if (refresh) lib.updateManga(manga.key, { chaptersRefreshedAt: new Date().toISOString() });
        const sorted = sortChapters(chapters);
        let current = manga.chapterKey ? sorted.findIndex((c) => `c${c.id}` === manga.chapterKey) : -1;
        if (current < 0) current = Math.max(0, sorted.findIndex((c) => !c.isRead));
        const windowKeys = new Set<string>();
        // Once the current chapter is read to its end, the window moves on, so with "1" the next chapter is
        // prepared when you finish this one, not before.
        const finished = Boolean(manga.chapterKey && lib.getChapter(manga.chapterKey)?.readAt);
        const start = finished ? current + 1 : current;
        sorted.slice(start, start + ahead).forEach((c) => {
          const key = `c${c.id}`;
          windowKeys.add(key);
          const existing = lib.getChapter(key);
          if (!existing) {
            lib.upsertChapter({ key, mangaKey: manga.key, name: c.name, order: sorted.indexOf(c), status: 'queued', pageCount: c.pageCount, pagesDone: 0 });
            enqueue(key);
          } else if (existing.status === 'queued' || existing.status === 'error') {
            enqueue(key);
          }
        });
        for (const c of lib.chaptersOf(manga.key)) {
          if (windowKeys.has(c.key)) continue;
          // Waiting chapters the window no longer reaches (the setting was lowered) are dropped.
          if (c.status === 'queued') {
            const i = queue.indexOf(c.key);
            if (i >= 0) queue.splice(i, 1);
            lib.removeChapter(c.key);
            continue;
          }
          const readLongAgo = c.readAt && Date.now() - Date.parse(c.readAt) > keepMs;
          const behind = c.order < current && (!c.readAt || readLongAgo);
          if (readLongAgo || behind) lib.removeChapter(c.key);
        }
      } else {
        for (const c of lib.chaptersOf(manga.key)) if (c.status === 'queued' || c.status === 'error') enqueue(c.key);
      }
    } catch (err) {
      log.warn(`Window sync failed for ${manga.title}`, err);
    }
  }
}

let syncTimer: NodeJS.Timeout | undefined;
export function scheduleSync(delayMs = 2000): void {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void syncWindows(), delayMs);
}

let started = false;
export function startMangaWorker(): void {
  if (started) return scheduleSync(100);
  // Chapters interrupted by a shutdown start over.
  for (const c of lib.allChapters()) {
    if (c.status === 'downloading' || c.status === 'ocr') lib.updateChapter(c.key, { status: 'queued', pagesDone: 0 });
  }
  // Chapters that were being read again when the service stopped.
  for (const c of lib.allChapters()) if (c.rereading) rereadChapter(c.key);
  // Chapters prepared before the language check.
  for (const c of lib.allChapters()) {
    if (c.status !== 'ready' || 'chinese' in c) continue;
    const chinese = looksChinese(lib.readChapterData(c.key)?.pages.flatMap((p) => p.blocks.map((b) => b.text)) ?? []) === true;
    lib.updateChapter(c.key, { chinese });
    if (chinese) markNotJapanese(c.mangaKey);
  }
  // Only touch Suwayomi when the user actually reads manga.
  if (!lib.listManga().some((m) => m.status === 'reading')) return;
  started = true;
  scheduleSync(15_000);
  setInterval(() => void syncWindows(), 30 * 60_000).unref();
}
