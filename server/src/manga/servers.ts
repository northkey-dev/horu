import { getSettings } from '../config.ts';

// Komga and Kavita: manga servers people already keep their volumes on. Horu lists series and volumes and
// downloads one as an archive into its own library (importer.ts), where it gets text recognition like any
// imported file.

export type ServerSeries = { id: string; name: string; books?: number };
export type ServerBook = { id: string; name: string };

const s = () => getSettings();
const base = () => s().mangaServerUrl.trim().replace(/\/+$/, '');

export const serverName = () => (s().mangaServerKind === 'kavita' ? 'Kavita' : 'Komga');

function configured(): void {
  if (s().mangaServerKind === 'none' || !base()) throw new Error('No manga server set up (Settings → Manga server)');
}

// ---- Komga: API key in X-API-Key ----

async function komga<T>(path: string): Promise<T> {
  const res = await fetch(`${base()}${path}`, { headers: { 'X-API-Key': s().mangaServerKey.trim(), Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Komga answered HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// ---- Kavita: the API key buys a short-lived token ----

let kavitaToken: { token: string; at: number } | undefined;
async function kavitaAuth(): Promise<string> {
  if (!kavitaToken || Date.now() - kavitaToken.at > 30 * 60_000) {
    const res = await fetch(`${base()}/api/Plugin/authenticate?apiKey=${encodeURIComponent(s().mangaServerKey.trim())}&pluginName=Horu`, { method: 'POST', signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Kavita refused the API key (HTTP ${res.status})`);
    kavitaToken = { token: ((await res.json()) as { token: string }).token, at: Date.now() };
  }
  return kavitaToken.token;
}

async function kavita<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await kavitaAuth();
  const res = await fetch(`${base()}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Kavita answered HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function searchServer(q: string): Promise<ServerSeries[]> {
  configured();
  if (s().mangaServerKind === 'komga') {
    const page = await komga<{ content: { id: string; name: string; booksCount: number }[] }>(`/api/v1/series?size=60&sort=metadata.titleSort,asc${q ? `&search=${encodeURIComponent(q)}` : ''}`);
    return page.content.map((x) => ({ id: x.id, name: x.name, books: x.booksCount }));
  }
  const res = await kavita<{ series: { seriesId: number; name: string }[] }>(`/api/Search/search?queryString=${encodeURIComponent(q || ' ')}`);
  return res.series.map((x) => ({ id: String(x.seriesId), name: x.name }));
}

export async function serverBooks(seriesId: string): Promise<ServerBook[]> {
  configured();
  if (s().mangaServerKind === 'komga') {
    const page = await komga<{ content: { id: string; name: string; metadata?: { title?: string } }[] }>(`/api/v1/series/${encodeURIComponent(seriesId)}/books?size=500&sort=metadata.numberSort,asc`);
    return page.content.map((b) => ({ id: b.id, name: b.metadata?.title || b.name }));
  }
  const volumes = await kavita<{ name: string; chapters: { id: number; range: string; title?: string }[] }[]>(`/api/Series/volumes?seriesId=${encodeURIComponent(seriesId)}`);
  return volumes.flatMap((v) => v.chapters.map((c) => ({ id: String(c.id), name: c.title || (v.name && v.name !== '0' && !/^-?100000$/.test(v.name) ? `Vol. ${v.name}${c.range && c.range !== '0' ? ` Ch. ${c.range}` : ''}` : `Ch. ${c.range}`) })));
}

/** The book/chapter as a zip of its pages. */
export async function downloadBook(id: string): Promise<Uint8Array> {
  configured();
  const url = s().mangaServerKind === 'komga' ? `${base()}/api/v1/books/${encodeURIComponent(id)}/file` : `${base()}/api/Download/chapter?chapterId=${encodeURIComponent(id)}`;
  const headers: Record<string, string> = s().mangaServerKind === 'komga' ? { 'X-API-Key': s().mangaServerKey.trim() } : { Authorization: `Bearer ${await kavitaAuth()}` };
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`${serverName()} answered HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
