import fs from 'node:fs';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import * as store from '../store.ts';
import * as lib from './library.ts';
import { enqueue } from './prepare.ts';

// Manga archives (.cbz/.zip) into the library: uploaded from the phone or downloaded from a Komga/Kavita
// server. Top-level folders become chapters; a flat archive is one chapter. A .mokuro file next to the
// images (mokuro's output for a volume) brings the text boxes along, so no text recognition has to run.

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif)$/i;

type MokuroPage = { img_path: string; img_width: number; img_height: number; blocks: { box: number[]; vertical: boolean; lines: string[] }[] };

function mokuroPages(files: Record<string, Uint8Array>): Map<string, MokuroPage> {
  const pages = new Map<string, MokuroPage>();
  for (const [name, bytes] of Object.entries(files)) {
    if (!name.endsWith('.mokuro')) continue;
    try {
      const data = JSON.parse(strFromU8(bytes)) as { pages?: MokuroPage[] };
      for (const p of data.pages ?? []) pages.set(path.posix.basename(p.img_path), p);
    } catch {
      // not valid JSON: ignore, the pages get OCR as usual
    }
  }
  return pages;
}

export function importArchive(zip: Uint8Array, fileName: string, opts: { mangaKey?: string; mangaTitle?: string; chapterName?: string; source?: string } = {}): string {
  const files = unzipSync(zip, { filter: (f) => !f.name.startsWith('__MACOSX') });
  const entries = Object.entries(files)
    .filter(([n, bytes]) => IMAGE_EXT.test(n) && bytes.length > 0)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  if (!entries.length) throw new Error('No images in that archive');
  const mokuro = mokuroPages(files);
  const title = opts.mangaTitle ?? fileName.replace(/\.(cbz|zip)$/i, '');
  const key = opts.mangaKey ?? `i${store.newId()}`;
  const groups = new Map<string, [string, Uint8Array][]>();
  for (const entry of entries) {
    const parts = entry[0].split('/');
    const group = parts.length > 1 ? parts.slice(0, -1).join('/') : title;
    groups.set(group, [...(groups.get(group) ?? []), entry]);
  }
  if (!lib.getManga(key)) lib.upsertManga({ key, title, source: opts.source ?? 'Imported file', addedAt: new Date().toISOString(), status: 'reading', hasThumb: false });
  let order = lib.chaptersOf(key).reduce((n, c) => Math.max(n, c.order + 1), 0);
  for (const [group, list] of groups) {
    const chapterKey = `${key}-${order + 1}`;
    const dir = lib.chapterDir(chapterKey);
    fs.mkdirSync(dir, { recursive: true });
    const pages: lib.ChapterPage[] = [];
    list.forEach(([n, bytes], i) => {
      const file = `${String(i).padStart(3, '0')}${path.extname(n).toLowerCase()}`;
      fs.writeFileSync(path.join(dir, file), bytes);
      const m = mokuro.get(path.posix.basename(n));
      if (m)
        pages.push({
          file,
          w: m.img_width,
          h: m.img_height,
          blocks: m.blocks.map((b) => ({ box: b.box.slice(0, 4) as [number, number, number, number], vertical: b.vertical, text: b.lines.join('') })).filter((b) => b.text.trim()),
        });
    });
    if (!lib.getManga(key)?.hasThumb) {
      fs.writeFileSync(lib.thumbPath(key), list[0][1]);
      lib.updateManga(key, { hasThumb: true });
    }
    const name = opts.chapterName && groups.size === 1 ? opts.chapterName : group.split('/').pop()!;
    if (pages.length === list.length) {
      // Every page came with mokuro's text: ready at once.
      lib.writeChapterData({ key: chapterKey, mangaKey: key, mangaTitle: lib.getManga(key)?.title ?? title, name, order, pages });
      lib.upsertChapter({ key: chapterKey, mangaKey: key, name, order, status: 'ready', pageCount: list.length, pagesDone: list.length, preparedAt: new Date().toISOString() });
    } else {
      lib.upsertChapter({ key: chapterKey, mangaKey: key, name, order, status: 'queued', pageCount: list.length, pagesDone: 0 });
      enqueue(chapterKey);
    }
    order++;
  }
  return key;
}
