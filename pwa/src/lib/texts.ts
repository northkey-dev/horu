import { strFromU8, unzipSync } from 'fflate';
import { api, laptopUp } from './api.ts';
import { toWav } from './mic.ts';
import { parseSubtitles, decodeSubtitleBytes } from '../../../shared/subtitles.ts';
import type { Cue } from '../../../shared/types.ts';
import { forget, recall, remember } from './mirror.ts';

// The text reader's library: articles, books (EPUB), pasted text. Kept on the phone (IndexedDB); web pages
// are fetched through the laptop because most sites do not allow a web app to read them directly.

/** `audio`: a podcast or other recording; every paragraph is one line with its time (`times:<id>`). `job`: the
 *  laptop is still transcribing it. */
export type TextMeta = { id: string; title: string; source: string; addedAt: string; paragraphs: number; progress: number; audio?: boolean; job?: string; error?: string };
export type LineTime = { start: number; end: number };

const LIST = 'texts';

export async function listTexts(): Promise<TextMeta[]> {
  return (await recall<TextMeta[]>(LIST))?.value ?? [];
}

export async function getText(id: string): Promise<{ meta: TextMeta; paragraphs: string[]; times?: LineTime[] } | undefined> {
  const meta = (await listTexts()).find((t) => t.id === id);
  const body = (await recall<string[]>(`text:${id}`))?.value;
  const times = meta?.audio ? (await recall<LineTime[]>(`times:${id}`))?.value : undefined;
  return meta && body ? { meta, paragraphs: body, times } : undefined;
}

export async function addText(title: string, text: string, source: string): Promise<TextMeta> {
  // Japanese prose has no hard line wraps, so every line is a paragraph.
  const paragraphs = text
    .split(/\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!paragraphs.length) throw new Error('No text');
  const meta: TextMeta = { id: `t${Date.now().toString(36)}`, title: title.trim() || paragraphs[0].slice(0, 30), source, addedAt: new Date().toISOString(), paragraphs: paragraphs.length, progress: 0 };
  await remember(`text:${meta.id}`, paragraphs);
  await remember(LIST, [meta, ...(await listTexts())]);
  return meta;
}

export async function removeText(id: string): Promise<void> {
  await forget(`text:${id}`);
  await forget(`times:${id}`);
  await forget(`audio:${id}`);
  await remember(LIST, (await listTexts()).filter((t) => t.id !== id));
}

export async function setProgress(id: string, progress: number): Promise<void> {
  await remember(
    LIST,
    (await listTexts()).map((t) => (t.id === id ? { ...t, progress } : t)),
  );
}

export async function fetchArticle(url: string): Promise<TextMeta> {
  const a = await api.fetchArticle(url);
  return addText(a.title, a.text, new URL(url).hostname.replace(/^www\./, ''));
}

/** Text of an HTML/XHTML document: block elements as paragraphs, furigana left out. */
function htmlText(html: string): string {
  const doc = new DOMParser().parseFromString(html, html.includes('xmlns') ? 'application/xhtml+xml' : 'text/html');
  doc.querySelectorAll('rt, rp, script, style').forEach((e) => e.remove());
  const blocks = [...doc.querySelectorAll('p, h1, h2, h3, h4, li, blockquote')].map((e) => e.textContent?.replace(/\s+/g, ' ').trim() ?? '');
  return (blocks.length ? blocks : [doc.body?.textContent ?? '']).filter(Boolean).join('\n\n');
}

/** EPUB: chapters in reading order (spine) from the zip. */
function epubText(bytes: Uint8Array): { title: string; text: string } {
  const files = unzipSync(bytes);
  const container = strFromU8(files['META-INF/container.xml'] ?? new Uint8Array());
  const opfPath = /full-path="([^"]+)"/.exec(container)?.[1];
  if (!opfPath || !files[opfPath]) throw new Error('Not an EPUB book');
  const opf = new DOMParser().parseFromString(strFromU8(files[opfPath]), 'application/xml');
  const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const manifest = new Map([...opf.getElementsByTagName('item')].map((i) => [i.getAttribute('id'), i.getAttribute('href')]));
  const chapters: string[] = [];
  for (const ref of opf.getElementsByTagName('itemref')) {
    const href = manifest.get(ref.getAttribute('idref'));
    const file = href && files[dir + decodeURIComponent(href)];
    if (file) chapters.push(htmlText(strFromU8(file)));
  }
  const title = opf.getElementsByTagName('dc:title')[0]?.textContent ?? '';
  return { title, text: chapters.filter(Boolean).join('\n\n') };
}

export async function importFile(file: File): Promise<TextMeta> {
  const name = file.name.replace(/\.[^.]+$/, '');
  if (/\.epub$/i.test(file.name)) {
    const book = epubText(new Uint8Array(await file.arrayBuffer()));
    return addText(book.title || name, book.text, 'Book');
  }
  const raw = await file.text();
  return addText(name, /\.x?html?$/i.test(file.name) ? htmlText(raw) : raw, 'File');
}

/** Photos of pages (a book, a sign, a menu): the laptop's text recognition reads them, one paragraph per block. */
export async function addPhotos(files: File[]): Promise<TextMeta> {
  if (!laptopUp()) throw new Error('Reading photos needs the laptop (its text recognition).');
  const blocks: string[] = [];
  for (const f of files) blocks.push(...(await api.photoText(f)).blocks.map((b) => b.text));
  if (!blocks.length) throw new Error('No Japanese text found on the photo.');
  const when = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  return addText(`Photo · ${when}`, blocks.join('\n'), 'Photo');
}

// ---- audio: podcasts, audio books, recordings ----

const AUDIO_TYPES = /\.(mp3|m4a|aac|wav|ogg|opus|flac|mp4)$/i;
export const isAudioFile = (f: File) => f.type.startsWith('audio/') || AUDIO_TYPES.test(f.name);

/** `.lrc` lyrics/transcripts: `[mm:ss.xx] text`, each line until the next. */
function parseLrc(text: string): Cue[] {
  const lines = [...text.matchAll(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/gm)].map((m) => ({ start: Number(m[1]) * 60 + Number(m[2]), text: m[3].trim() }));
  return lines.filter((l) => l.text).map((l, i, all) => ({ start: l.start, end: all[i + 1]?.start ?? l.start + 8, text: l.text }));
}

async function saveLines(id: string, cues: Cue[]): Promise<number> {
  const lines = cues.filter((c) => c.text.trim()).sort((a, b) => a.start - b.start);
  if (!lines.length) throw new Error('No lines found');
  await remember(`text:${id}`, lines.map((c) => c.text.replace(/\s*\n\s*/g, ' ').trim()));
  await remember(`times:${id}`, lines.map((c) => ({ start: c.start, end: c.end })));
  return lines.length;
}

async function updateMeta(id: string, patch: Partial<TextMeta>): Promise<void> {
  await remember(
    LIST,
    (await listTexts()).map((t) => (t.id === id ? { ...t, ...patch } : t)),
  );
}

/** Adds a recording. Lines come from a subtitle file next to it (.srt, .vtt, .lrc), else the laptop transcribes. */
export async function addAudio(audio: File, subs?: File): Promise<TextMeta> {
  const cues = subs ? (/\.lrc$/i.test(subs.name) ? parseLrc(await subs.text()) : parseSubtitles(subs.name, decodeSubtitleBytes(new Uint8Array(await subs.arrayBuffer())))) : undefined;
  if (!cues && !laptopUp()) throw new Error('Add a subtitle or transcript file with it (.srt, .vtt, .lrc), or connect the laptop: it writes the lines with Whisper.');
  const id = `t${Date.now().toString(36)}`;
  const meta: TextMeta = { id, title: audio.name.replace(/\.[^.]+$/, ''), source: 'Audio', addedAt: new Date().toISOString(), paragraphs: 0, progress: 0, audio: true };
  if (cues) meta.paragraphs = await saveLines(id, cues);
  else meta.job = (await api.transcribeAudio(audio)).id;
  await remember(`audio:${id}`, { type: audio.type || 'audio/mpeg', bytes: await audio.arrayBuffer() });
  await remember(LIST, [meta, ...(await listTexts())]);
  return meta;
}

/** Collects finished transcriptions from the laptop; true while some are still running. */
export async function finishTranscripts(): Promise<boolean> {
  let running = false;
  for (const t of (await listTexts()).filter((t) => t.job)) {
    const job = await api.transcription(t.job!).catch((e: Error) => ({ state: 'error' as const, error: e.message, cues: undefined }));
    if (job.state === 'working') running = true;
    else if (job.state === 'done' && job.cues?.length) await updateMeta(t.id, { job: undefined, error: undefined, paragraphs: await saveLines(t.id, job.cues) });
    else await updateMeta(t.id, { job: undefined, error: job.error ?? 'Whisper heard no speech.' });
  }
  return running;
}

export async function audioBlob(id: string): Promise<Blob | undefined> {
  const a = (await recall<{ type: string; bytes: ArrayBuffer }>(`audio:${id}`))?.value;
  return a ? new Blob([a.bytes], { type: a.type }) : undefined;
}

// Decoded at 16 kHz mono (plenty for speech, a tenth of the memory), once per recording while it is open.
let decoded: { id: string; samples: Promise<Float32Array> } | undefined;
const RATE = 16000;

/** One line of a recording as WAV, with a little air around it, for a card. */
export async function clipLine(id: string, line: LineTime): Promise<{ wav: Blob; clipStart: number; seconds: number } | undefined> {
  if (decoded?.id !== id) {
    decoded = {
      id,
      samples: (async () => {
        const blob = await audioBlob(id);
        if (!blob) throw new Error('Audio missing');
        const ctx = new OfflineAudioContext(1, 1, RATE);
        return (await ctx.decodeAudioData(await blob.arrayBuffer())).getChannelData(0);
      })(),
    };
  }
  const samples = await decoded.samples.catch(() => undefined);
  if (!samples) return undefined;
  const clipStart = Math.max(0, line.start - 0.4);
  const end = Math.min(samples.length / RATE, line.end + 0.4);
  return { wav: toWav(samples.slice(Math.floor(clipStart * RATE), Math.floor(end * RATE)), RATE), clipStart, seconds: end - clipStart };
}

// ---- words read ----

const pad = (n: number) => String(n).padStart(2, '0');
function today(): string {
  const d = new Date(Date.now() - 4 * 3600_000); // same 4 am day boundary as the laptop
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const READ = 'horu-words-read';
let unsent = 0;
let sendTimer: number | undefined;

export function wordsReadToday(): number {
  try {
    const r = JSON.parse(localStorage.getItem(READ) ?? '{}') as Record<string, number>;
    return r[today()] ?? 0;
  } catch {
    return 0;
  }
}

/** Counts words of a paragraph the user read past; sent to the laptop in batches (counts for XP there). */
export function countRead(words: number): void {
  if (words <= 0) return;
  try {
    const r = JSON.parse(localStorage.getItem(READ) ?? '{}') as Record<string, number>;
    r[today()] = (r[today()] ?? 0) + words;
    localStorage.setItem(READ, JSON.stringify(r));
  } catch {
    // counter only
  }
  unsent += words;
  clearTimeout(sendTimer);
  sendTimer = window.setTimeout(flushRead, 20_000);
}

export function flushRead(): void {
  if (!unsent) return;
  const words = unsent;
  unsent = 0;
  void api.wordsRead(today(), words).catch(() => undefined);
}
