import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import { getSettings } from '../config.ts';
import { run } from '../proc.ts';
import { log } from '../log.ts';
import * as store from '../store.ts';
import { primingFor } from '../knownWords.ts';
import * as lib from './library.ts';
import * as suwa from './suwayomi.ts';
import { enqueue, ocrAvailable, pauseManga, resumeChapter, scheduleSync, sortChapters, startMangaWorker as start, stopChapter } from './prepare.ts';
import { importArchive } from './importer.ts';
import { cropAround } from '../crop.ts';
import { downloadBook, searchServer, serverBooks, serverName } from './servers.ts';

export { start as startMangaWorker };

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif)$/i;

const h =
  (fn: (req: Request, res: Response) => unknown) =>
  async (req: Request, res: Response): Promise<void> => {
    try {
      const out = await fn(req, res);
      if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (err) {
      log.warn(`manga ${req.method} ${req.path}:`, (err as Error).message);
      if (!res.headersSent) res.status(400).json({ error: (err as Error).message });
    }
  };

const param = (req: Request, name: string) => String(req.params[name]);

function imageType(file: string): string {
  const head = Buffer.alloc(12);
  const fd = fs.openSync(file, 'r');
  fs.readSync(fd, head, 0, 12, 0);
  fs.closeSync(fd);
  if (head[0] === 0x89 && head[1] === 0x50) return 'image/png';
  if (head.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (head.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
  return 'image/jpeg';
}

async function saveThumb(key: string, url: string | null): Promise<boolean> {
  if (!url) return false;
  try {
    const { bytes } = await suwa.fetchBinary(url);
    fs.writeFileSync(lib.thumbPath(key), bytes);
    return true;
  } catch {
    return false;
  }
}

function libraryView() {
  return lib.listManga().map((m) => {
    const chapters = lib.chaptersOf(m.key);
    return {
      ...m,
      ready: chapters.filter((c) => c.status === 'ready').length,
      preparing: chapters.filter((c) => c.status !== 'ready' && c.status !== 'error').length,
      failed: chapters.filter((c) => c.status === 'error').length,
    };
  });
}

export function mangaRouter(): express.Router {
  const r = express.Router();
  r.use(express.json());

  r.get(
    '/status',
    h(() => ({ suwayomiInstalled: suwa.suwayomiInstalled(), ocrAvailable: ocrAvailable() })),
  );

  // ---- sources ----

  r.get(
    '/extensions',
    h(async (req) => {
      const lang = String(req.query.lang ?? 'ja');
      return (await suwa.listExtensions()).filter((e) => (getSettings().showAdultSources || !e.isNsfw) && (e.lang === lang || (lang === 'ja' && e.lang === 'all')));
    }),
  );
  r.post(
    '/extensions/:pkg',
    h(async (req) => {
      await suwa.setExtensionInstalled(param(req, 'pkg'), Boolean(req.body?.install));
      return { ok: true };
    }),
  );
  r.get('/sources', h(async () => (await suwa.listSources()).filter((s) => s.lang === 'ja' || s.lang === 'all')));
  r.get('/search', h((req) => suwa.searchSource(String(req.query.source), String(req.query.q ?? ''), Number(req.query.page ?? 1))));

  r.get(
    '/remote/:id',
    h(async (req) => {
      const id = Number(param(req, 'id'));
      const { manga, chapters } = await suwa.mangaWithChapters(id, req.query.refresh === '1');
      const key = `s${id}`;
      return {
        manga: { ...manga, key, active: lib.getManga(key) },
        chapters: sortChapters(chapters).map((c) => ({ ...c, key: `c${c.id}`, prepared: lib.getChapter(`c${c.id}`) })),
      };
    }),
  );
  r.get('/remote/:id/thumb', async (req, res) => {
    try {
      const { bytes, type } = await suwa.fetchBinary(`/api/v1/manga/${Number(param(req, 'id'))}/thumbnail`);
      res.type(type).set('Cache-Control', 'public, max-age=86400').send(bytes);
    } catch {
      res.status(404).end();
    }
  });

  // ---- library ----

  r.get('/library', h(() => libraryView()));

  r.post(
    '/library',
    h(async (req) => {
      const id = Number(req.body?.mangaId);
      const key = `s${id}`;
      const active = lib.listManga().filter((m) => m.status === 'reading' && m.key !== key).length;
      if (active >= getSettings().mangaMaxActive) throw new Error(`You already read ${active} manga. Pause one first (max ${getSettings().mangaMaxActive}).`);
      const { manga } = await suwa.mangaWithChapters(id, true);
      await suwa.setInLibrary(id, true).catch(() => {});
      lib.upsertManga({
        key,
        title: manga.title,
        source: manga.source?.displayName ?? '',
        description: manga.description ?? undefined,
        addedAt: lib.getManga(key)?.addedAt ?? new Date().toISOString(),
        status: 'reading',
        hasThumb: await saveThumb(key, manga.thumbnailUrl),
        chapterKey: req.body?.chapterKey ?? lib.getManga(key)?.chapterKey,
        chaptersRefreshedAt: new Date().toISOString(),
      });
      start();
      scheduleSync(100);
      return libraryView().find((m) => m.key === key);
    }),
  );

  r.patch(
    '/library/:key',
    h((req) => {
      const key = param(req, 'key');
      const status = req.body?.status as 'reading' | 'paused' | undefined;
      if (status === 'reading') {
        const active = lib.listManga().filter((m) => m.status === 'reading' && m.key !== key).length;
        if (active >= getSettings().mangaMaxActive) throw new Error(`Max ${getSettings().mangaMaxActive} manga at a time.`);
      }
      if (status) lib.updateManga(key, { status });
      scheduleSync(100);
      return libraryView().find((m) => m.key === key);
    }),
  );

  r.delete(
    '/library/:key',
    h((req) => {
      lib.removeManga(param(req, 'key'));
      return { ok: true };
    }),
  );

  r.get(
    '/library/:key/chapters',
    h((req) => lib.chaptersOf(param(req, 'key'))),
  );

  r.get('/thumb/:key', (req, res) => {
    const file = lib.thumbPath(param(req, 'key'));
    if (!fs.existsSync(file)) return void res.status(404).end();
    res.type(imageType(file)).set('Cache-Control', 'public, max-age=86400').sendFile(file);
  });

  // ---- chapters ----

  /** Live mode: prepare a chapter now (e.g. something outside the window). */
  r.post(
    '/chapters/:key/prepare',
    h((req) => {
      const key = param(req, 'key');
      const mangaKey = String(req.body?.mangaKey ?? '');
      if (!lib.getChapter(key)) {
        if (!lib.getManga(mangaKey)) throw new Error('Add the manga to your library first');
        lib.upsertChapter({ key, mangaKey, name: String(req.body?.name ?? key), order: Number(req.body?.order ?? 0), status: 'queued', pageCount: 0, pagesDone: 0 });
      } else if (['error', 'paused', 'cancelled'].includes(lib.getChapter(key)!.status)) {
        lib.updateChapter(key, { status: 'queued', error: undefined });
      }
      enqueue(key, true);
      return lib.getChapter(key);
    }),
  );

  /** Pause keeps the pages so far, cancel removes them; cancel on a ready chapter deletes it. */
  for (const how of ['pause', 'cancel'] as const) {
    r.post(
      `/chapters/:key/${how}`,
      h((req) => {
        stopChapter(param(req, 'key'), how);
        return lib.getChapter(param(req, 'key'));
      }),
    );
  }
  r.post(
    '/chapters/:key/resume',
    h((req) => {
      resumeChapter(param(req, 'key'));
      return lib.getChapter(param(req, 'key'));
    }),
  );
  r.post(
    '/library/:key/downloads',
    h((req) => {
      pauseManga(param(req, 'key'), req.body?.pause === true);
      return lib.chaptersOf(param(req, 'key'));
    }),
  );

  /** Mark a chapter read (or unread again). Read chapters are cleaned up after the days set in Settings. */
  r.post(
    '/chapters/:key/read',
    h(async (req) => {
      const key = param(req, 'key');
      const read = req.body?.read !== false;
      if (!lib.getChapter(key)) throw new Error('Unknown chapter');
      lib.updateChapter(key, { readAt: read ? new Date().toISOString() : undefined });
      if (key.startsWith('c')) await suwa.markChapterRead(Number(key.slice(1)), 0, read).catch(() => {});
      scheduleSync();
      return lib.getChapter(key);
    }),
  );

  /** Disk use of the prepared chapters, and how much of it is chapters you have read. */
  r.get(
    '/storage',
    h(() => {
      const all = lib.allChapters().map((c) => ({ c, bytes: lib.chapterBytes(c.key) }));
      const read = all.filter(({ c }) => c.readAt && c.status === 'ready');
      const sum = (l: { bytes: number }[]) => l.reduce((n, x) => n + x.bytes, 0);
      return { bytes: sum(all), chapters: all.filter((x) => x.bytes > 0).length, readBytes: sum(read), readChapters: read.length };
    }),
  );

  /** Deletes every chapter that is read; returns their keys so the phone can drop its copies too. */
  r.post(
    '/cleanup',
    h(() => {
      const done = lib.allChapters().filter((c) => c.readAt && c.status === 'ready');
      const freed = done.reduce((n, c) => n + lib.chapterBytes(c.key), 0);
      for (const c of done) lib.removeChapter(c.key);
      return { keys: done.map((c) => c.key), freed };
    }),
  );

  r.get(
    '/chapters/:key',
    h((req) => {
      const key = param(req, 'key');
      const chapter = lib.getChapter(key);
      if (!chapter) throw new Error('Unknown chapter');
      return { chapter, data: chapter.status === 'ready' ? lib.readChapterData(key) : undefined };
    }),
  );

  /** Difficulty of a prepared chapter and its key new words (same preview as for episodes). */
  r.get(
    '/chapters/:key/insight',
    h(async (req) => {
      const data = lib.readChapterData(param(req, 'key'));
      if (!data) throw new Error('Chapter is not prepared yet');
      return primingFor(data.pages.flatMap((p) => p.blocks.map((b) => b.text)));
    }),
  );

  r.get('/files/:key/:file', (req, res) => {
    const file = path.join(lib.chapterDir(param(req, 'key')), path.basename(param(req, 'file')));
    if (!IMAGE_EXT.test(file) || !fs.existsSync(file)) return void res.status(404).end();
    res.type(imageType(file)).set('Cache-Control', 'public, max-age=31536000, immutable').sendFile(file);
  });

  /** Everything the phone should keep offline: ready chapters of manga being read. */
  r.get(
    '/offline',
    h(() =>
      lib
        .listManga()
        .filter((m) => m.status === 'reading')
        .flatMap((m) =>
          lib
            .chaptersOf(m.key)
            .filter((c) => c.status === 'ready')
            .map((c) => {
              const data = lib.readChapterData(c.key);
              return { key: c.key, mangaKey: m.key, name: c.name, order: c.order, preparedAt: c.preparedAt, files: data?.pages.map((p) => p.file) ?? [] };
            }),
        ),
    ),
  );

  r.post(
    '/progress',
    h(async (req) => {
      const { mangaKey, chapterKey, page, finished, at } = req.body as { mangaKey: string; chapterKey: string; page: number; finished?: boolean; at?: string };
      const manga = lib.getManga(mangaKey);
      if (!manga) return { ok: false };
      // Ignore stale offline updates that arrive after newer progress.
      if (at && manga.lastReadAt && at < manga.lastReadAt) return { ok: true };
      lib.updateManga(mangaKey, { chapterKey, page, lastReadAt: at ?? new Date().toISOString() });
      if (finished) {
        lib.updateChapter(chapterKey, { readAt: at ?? new Date().toISOString() });
        if (chapterKey.startsWith('c')) suwa.markChapterRead(Number(chapterKey.slice(1)), page, true).catch(() => {});
      }
      scheduleSync();
      return { ok: true };
    }),
  );

  // ---- mining ----

  r.post(
    '/mine',
    h(async (req) => {
      const { mangaKey, chapterKey, page, block, text, at, targetHint } = req.body as {
        mangaKey: string;
        chapterKey: string;
        page: number;
        block?: number;
        text: string;
        at?: string;
        /** The word tapped in the reader: the inbox preselects it */
        targetHint?: string;
      };
      if (!text?.trim()) throw new Error('No text');
      const manga = lib.getManga(mangaKey);
      const data = lib.readChapterData(chapterKey);
      const chapterName = data?.name ?? lib.getChapter(chapterKey)?.name ?? '';
      const title = manga?.title ?? data?.mangaTitle ?? 'Manga';
      const id = store.newId();
      let hasImage = false;
      const pageInfo = data?.pages[page];
      if (pageInfo) {
        const src = path.join(lib.chapterDir(chapterKey), pageInfo.file);
        hasImage = await cropAround(src, pageInfo, block !== undefined ? pageInfo.blocks[block]?.box : undefined, store.mediaPath(id, 'jpg'));
      }
      return store.addMoment({
        id,
        kind: 'manga',
        createdAt: at ?? new Date().toISOString(),
        status: 'ready',
        title,
        mangaTitle: title,
        chapterName,
        page,
        sourceLabel: `${title} · ${chapterName} · p.${page + 1}`,
        hasAudio: false,
        hasImage,
        candidates: [{ start: 0, end: 0, text: text.trim(), source: 'ocr' }],
        targetHint: targetHint?.trim() || undefined,
      });
    }),
  );

  // ---- import (.cbz / .zip) ----

  r.post(
    '/import',
    express.raw({ type: () => true, limit: '500mb' }),
    h((req) => {
      const fileName = decodeURIComponent(String(req.headers['x-filename'] ?? 'import.cbz'));
      const key = importArchive(new Uint8Array(req.body as Buffer), fileName);
      return libraryView().find((m) => m.key === key);
    }),
  );

  // ---- Komga / Kavita (see servers.ts) ----

  r.get('/server/search', h((req) => searchServer(String(req.query.q ?? ''))));
  r.get('/server/series/:id', h((req) => serverBooks(param(req, 'id'))));
  r.post(
    '/server/import',
    h(async (req) => {
      const { seriesId, seriesName, bookId, bookName } = req.body as { seriesId: string; seriesName: string; bookId: string; bookName: string };
      const zip = await downloadBook(bookId);
      const key = importArchive(zip, `${bookName}.cbz`, { mangaKey: `k${seriesId.replace(/[^\w-]/g, '')}`, mangaTitle: seriesName, chapterName: bookName, source: serverName() });
      return libraryView().find((m) => m.key === key);
    }),
  );

  return r;
}

