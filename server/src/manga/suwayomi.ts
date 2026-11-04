import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { DATA_DIR, TOOLS_DIR, getSettings } from '../config.ts';
import { log } from '../log.ts';

// Suwayomi-Server (https://github.com/Suwayomi/Suwayomi-Server) provides manga
// sources through the community-maintained Mihon/Tachiyomi extensions. Horu
// starts the bundled copy in tools/suwayomi on demand and talks GraphQL to it.

const SUWAYOMI_DIR = path.join(TOOLS_DIR, 'suwayomi');
// Windows: the release bundles a Java runtime. macOS/Linux: install.sh puts only the jar there and uses Java 21 from the system.
const BUNDLED_JAVA = path.join(SUWAYOMI_DIR, 'jre', 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
const JAVA = fs.existsSync(BUNDLED_JAVA) || process.platform === 'win32' ? BUNDLED_JAVA : 'java';
const JAR = path.join(SUWAYOMI_DIR, 'bin', 'Suwayomi-Server.jar');

let child: ChildProcess | undefined;
let starting: Promise<void> | undefined;
let storeChecked = '';

const base = () => getSettings().suwayomiUrl.replace(/\/$/, '');

export function suwayomiInstalled(): boolean {
  return fs.existsSync(JAR) && (JAVA === 'java' || fs.existsSync(JAVA));
}

async function reachable(): Promise<boolean> {
  try {
    const res = await fetch(`${base()}/api/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{__typename}' }),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function ensureSuwayomi(): Promise<void> {
  starting ??= (async () => {
    if (await reachable()) return void (await ensureExtensionStore());
    if (!suwayomiInstalled()) throw new Error('Suwayomi is not installed (tools/suwayomi).');
    log.info('Starting Suwayomi…');
    const prop = (k: string, v: string) => `-Dsuwayomi.tachidesk.config.server.${k}=${v}`;
    child = spawn(
      JAVA,
      [
        prop('initialOpenInBrowserEnabled', 'false'),
        prop('systemTrayEnabled', 'false'),
        prop('rootDir', path.join(DATA_DIR, 'suwayomi')),
        '-jar',
        JAR,
      ],
      { cwd: SUWAYOMI_DIR, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    // Keep the last lines of output so a failed start can say why.
    const tail: string[] = [];
    const keep = (d: Buffer) => {
      tail.push(...d.toString('utf8').split(/\r?\n/).filter(Boolean));
      tail.splice(0, tail.length - 15);
    };
    child.stdout!.on('data', keep);
    child.stderr!.on('data', keep);
    let exitCode: number | null | undefined;
    child.on('exit', (code) => {
      log.info(`Suwayomi exited (${code})`);
      if (code) log.warn('Suwayomi output:\n' + tail.join('\n'));
      exitCode = code;
      child = undefined;
    });
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (exitCode !== undefined) throw new Error(`Suwayomi stopped during start (exit ${exitCode}). Details in horu.log.`);
      if (await reachable()) {
        await ensureExtensionStore();
        return;
      }
    }
    throw new Error('Suwayomi did not start within 90 s.');
  })().finally(() => (starting = undefined));
  return starting;
}

export function stopSuwayomi(): void {
  child?.kill();
}

export async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  await ensureSuwayomi();
  return rawGql<T>(query, variables);
}

async function rawGql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${base()}/api/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(120_000),
  });
  const data = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (data.errors?.length) throw new Error(`Suwayomi: ${data.errors[0].message}`);
  return data.data as T;
}

/** Downloads an image/page through Suwayomi (relative paths like /api/v1/manga/1/chapter/2/page/0). */
export async function fetchBinary(urlPath: string): Promise<{ bytes: Buffer; type: string }> {
  await ensureSuwayomi();
  const url = urlPath.startsWith('http') ? urlPath : `${base()}${urlPath}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Page download failed: ${res.status}`);
  return { bytes: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') ?? 'image/jpeg' };
}

/** Adds the extension repository from Settings → Manga to Suwayomi (Horu ships none: the user chooses). */
async function ensureExtensionStore(): Promise<void> {
  const url = getSettings().mangaExtensionRepo.trim();
  if (!url || storeChecked === url) return;
  storeChecked = url;
  try {
    const { extensionStores } = await rawGql<{ extensionStores: { nodes: { indexUrl: string }[] } }>('{ extensionStores { nodes { indexUrl } } }');
    if (extensionStores.nodes.some((n) => n.indexUrl === url)) return;
    await rawGql('mutation($url: String!) { addExtensionStore(input: { indexUrl: $url }) { clientMutationId } }', { url });
    log.info('Added extension repository to Suwayomi', url);
  } catch (err) {
    log.warn('Could not configure extension store', err);
  }
}

// ---- typed helpers ----

export type Extension = { pkgName: string; name: string; lang: string; isInstalled: boolean; hasUpdate: boolean; iconUrl: string; isNsfw?: boolean };
export type Source = { id: string; name: string; lang: string; displayName: string; iconUrl: string };
export type MangaSummary = { id: number; title: string; thumbnailUrl: string | null; inLibrary: boolean; sourceId?: string };
export type Chapter = {
  id: number;
  name: string;
  chapterNumber: number;
  sourceOrder: number;
  isRead: boolean;
  pageCount: number;
  uploadDate: string;
  scanlator: string | null;
};

export async function listExtensions(): Promise<Extension[]> {
  const data = await gql<{ fetchExtensions: { extensions: Extension[] } }>(
    'mutation { fetchExtensions(input: {}) { extensions { pkgName name lang isInstalled hasUpdate iconUrl isNsfw } } }',
  );
  return data.fetchExtensions.extensions;
}

export async function setExtensionInstalled(pkgName: string, install: boolean): Promise<void> {
  await gql('mutation($id: String!, $patch: UpdateExtensionPatchInput!) { updateExtension(input: { id: $id, patch: $patch }) { clientMutationId } }', {
    id: pkgName,
    patch: install ? { install: true } : { uninstall: true },
  });
}

export async function listSources(): Promise<Source[]> {
  const data = await gql<{ sources: { nodes: Source[] } }>('{ sources { nodes { id name lang displayName iconUrl } } }');
  return data.sources.nodes.filter((s) => s.id !== '0'); // 0 = local source
}

export async function searchSource(sourceId: string, query: string, page = 1): Promise<{ mangas: MangaSummary[]; hasNextPage: boolean }> {
  const type = query.trim() ? 'SEARCH' : 'POPULAR';
  const data = await gql<{ fetchSourceManga: { mangas: MangaSummary[]; hasNextPage: boolean } }>(
    `mutation($source: LongString!, $query: String, $page: Int!) {
      fetchSourceManga(input: { source: $source, type: ${type}, query: $query, page: $page }) { hasNextPage mangas { id title thumbnailUrl inLibrary } }
    }`,
    { source: sourceId, query: query.trim() || null, page },
  );
  return data.fetchSourceManga;
}

export async function mangaWithChapters(
  mangaId: number,
  refresh: boolean,
): Promise<{ manga: MangaSummary & { description: string | null; author: string | null; source: { displayName: string } | null }; chapters: Chapter[] }> {
  if (refresh) {
    const data = await gql<{
      fetchMangaAndChapters: { manga: MangaSummary & { description: string | null; author: string | null; source: { displayName: string } | null }; chapters: Chapter[] };
    }>(
      `mutation($id: Int!) { fetchMangaAndChapters(input: { id: $id, fetchManga: true, fetchChapters: true }) {
        manga { id title thumbnailUrl inLibrary description author source { displayName } }
        chapters { id name chapterNumber sourceOrder isRead pageCount uploadDate scanlator }
      } }`,
      { id: mangaId },
    );
    return data.fetchMangaAndChapters;
  }
  const data = await gql<{
    manga: MangaSummary & { description: string | null; author: string | null; source: { displayName: string } | null; chapters: { nodes: Chapter[] } };
  }>(
    `query($id: Int!) { manga(id: $id) { id title thumbnailUrl inLibrary description author source { displayName }
      chapters { nodes { id name chapterNumber sourceOrder isRead pageCount uploadDate scanlator } } } }`,
    { id: mangaId },
  );
  const { chapters, ...manga } = data.manga;
  return { manga, chapters: chapters.nodes };
}

export async function setInLibrary(mangaId: number, inLibrary: boolean): Promise<void> {
  await gql('mutation($id: Int!, $v: Boolean) { updateManga(input: { id: $id, patch: { inLibrary: $v } }) { clientMutationId } }', { id: mangaId, v: inLibrary });
}

export async function chapterPages(chapterId: number): Promise<string[]> {
  const data = await gql<{ fetchChapterPages: { pages: string[] } }>(
    'mutation($id: Int!) { fetchChapterPages(input: { chapterId: $id }) { pages } }',
    { id: chapterId },
  );
  return data.fetchChapterPages.pages;
}

export async function markChapterRead(chapterId: number, lastPageRead: number, isRead: boolean): Promise<void> {
  await gql('mutation($id: Int!, $p: Int, $r: Boolean) { updateChapter(input: { id: $id, patch: { lastPageRead: $p, isRead: $r } }) { clientMutationId } }', {
    id: chapterId,
    p: lastPageRead,
    r: isRead,
  });
}
