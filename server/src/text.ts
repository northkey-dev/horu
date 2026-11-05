import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import { DATA_DIR, writeJsonAtomic } from './config.ts';
import { toHiragana, tokenizer } from './japanese.ts';
import { knownSet, statusMap } from './knownWords.ts';
import { lookupIndex } from './dict.ts';
import { notify } from './webhook.ts';
import { transcribe, whisperAvailable } from './whisper.ts';
import { log } from './log.ts';
import * as store from './store.ts';
import { splitSentences } from '../../shared/sentences.ts';
import type { Moment } from '../../shared/types.ts';
import type { WordStatus } from '../../shared/words.ts';
import { parseImport } from '../../shared/importLines.ts';

// Reading outside anime and manga: the extension highlights unknown words on any web page and mines sentences
// from it, the app's text reader fetches articles through here, and words read count for the statistics.

const h =
  (fn: (req: Request) => unknown) =>
  async (req: Request, res: Response): Promise<void> => {
    try {
      res.json((await fn(req)) ?? { ok: true });
    } catch (err) {
      log.warn(`text ${req.path}:`, (err as Error).message);
      res.status(400).json({ error: (err as Error).message });
    }
  };

const CONTENT_POS = new Set(['名詞', '動詞', '形容詞', '副詞', '連体詞', '感動詞', '形容動詞']);
const SKIP_DETAIL = new Set(['固有名詞', '数', '代名詞', '非自立', '接尾']);

/** A word worth highlighting: offsets in the text, dictionary form, reading, status (absent = new). */
export type TextWord = { start: number; end: number; base: string; reading: string; status?: WordStatus; known: boolean };

export async function analyseText(text: string): Promise<TextWord[]> {
  const t = await tokenizer();
  const known = await knownSet();
  const status = statusMap();
  const index = lookupIndex();
  const out: TextWord[] = [];
  let pos = 0;
  for (const tok of t.tokenize(text)) {
    const start = pos;
    pos += tok.surface_form.length;
    if (!CONTENT_POS.has(tok.pos) || SKIP_DETAIL.has(tok.pos_detail_1)) continue;
    const base = tok.basic_form && tok.basic_form !== '*' ? tok.basic_form : tok.surface_form;
    if (!/[぀-ヿ㐀-鿿]/.test(base) || /^[぀-ゟ]$/.test(base)) continue;
    if (index && !index.has(base) && !index.has(tok.surface_form)) continue;
    out.push({
      start,
      end: pos,
      base,
      reading: tok.reading && tok.reading !== '*' ? toHiragana(tok.reading) : '',
      status: status[base],
      known: known.has(base) || known.has(tok.surface_form),
    });
  }
  return out;
}

// ---- reading statistics ----

const READ_FILE = path.join(DATA_DIR, 'reading.json');

export function wordsReadByDay(): Record<string, number> {
  try {
    return JSON.parse(fs.readFileSync(READ_FILE, 'utf8')) as Record<string, number>;
  } catch {
    return {};
  }
}

// ---- articles for the reader ----

const decodeEntities = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(Number.parseInt(n, 16)));

/** Readable text of an article page: paragraphs and headings of <article>/<main>, furigana removed. */
export function extractArticle(html: string): { title: string; text: string } {
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim();
  let body = html
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|iframe)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<rt\b[\s\S]*?<\/rt>|<rp\b[\s\S]*?<\/rp>/gi, '');
  const main = /<article\b[\s\S]*<\/article>/i.exec(body)?.[0] ?? /<main\b[\s\S]*<\/main>/i.exec(body)?.[0];
  if (main) body = main;
  const blocks: string[] = [];
  for (const m of body.matchAll(/<(p|h[1-4]|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const text = decodeEntities(m[2].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
      .replace(/[ \t　]+/g, ' ')
      .trim();
    if (/[぀-ヿ㐀-鿿]/.test(text) && text.length > 1) blocks.push(text);
  }
  return { title, text: [...new Set(blocks)].join('\n\n') };
}

async function fetchArticle(url: string): Promise<{ title: string; text: string; url: string }> {
  if (!/^https?:\/\//.test(url)) throw new Error('Not a web address');
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Horu reader)' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`The page answered HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 4000));
  const charset = /charset=["']?([\w-]+)/i.exec(res.headers.get('content-type') ?? '')?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ?? 'utf-8';
  let html: string;
  try {
    html = new TextDecoder(charset.toLowerCase()).decode(bytes);
  } catch {
    html = new TextDecoder().decode(bytes);
  }
  const article = extractArticle(html);
  if (!article.text) throw new Error('No Japanese text found on that page');
  return { ...article, url };
}

// Podcasts and other audio: the app sends the file, Whisper writes the lines with times (about as long as the
// audio on a laptop CPU), the app polls. Jobs live in memory; the app keeps the result.
type Job = { state: 'working' | 'done' | 'error'; cues?: { start: number; end: number; text: string }[]; error?: string };
const jobs = new Map<string, Job>();
const AUDIO_DIR = path.join(DATA_DIR, 'audio-jobs');

export function textRouter(): express.Router {
  const r = express.Router();
  r.post(
    '/transcribe',
    express.raw({ type: () => true, limit: '400mb' }),
    h((req) => {
      if (!whisperAvailable()) throw new Error('Whisper is not installed on the laptop (install the whisper module).');
      const body = req.body as Buffer;
      if (!body?.length) throw new Error('No audio');
      const ext = (/\.(\w{2,4})$/.exec(String(req.headers['x-filename'] ?? '')) ?? [])[1] ?? 'mp3';
      const id = store.newId();
      fs.mkdirSync(AUDIO_DIR, { recursive: true });
      const file = path.join(AUDIO_DIR, `${id}.${ext.toLowerCase()}`);
      fs.writeFileSync(file, body);
      jobs.set(id, { state: 'working' });
      log.info(`Transcribing ${Math.round(body.length / 1e6)} MB of audio`);
      transcribe(file)
        .then((cues) => jobs.set(id, { state: 'done', cues }))
        .catch((e: Error) => jobs.set(id, { state: 'error', error: e.message }))
        .finally(() => fs.rmSync(file, { force: true }));
      return { id };
    }),
  );
  r.get(
    '/transcribe/:id',
    h((req) => {
      const job = jobs.get(String(req.params.id));
      if (!job) throw new Error('This transcription is gone (the laptop restarted). Open the audio again.');
      return job;
    }),
  );
  r.use(express.json({ limit: '2mb' }));

  /** Words of each text with their status (for highlighting on web pages and in the reader). */
  r.post(
    '/analyse',
    h(async (req) => {
      const texts = Array.isArray(req.body?.texts) ? (req.body.texts as unknown[]).map(String).slice(0, 200) : [];
      let budget = 20_000;
      const out: TextWord[][] = [];
      for (const t of texts) {
        budget -= t.length;
        out.push(budget >= 0 ? await analyseText(t) : []);
      }
      return out;
    }),
  );

  /** A sentence from a web page or the reader goes to the inbox. */
  r.post(
    '/mine',
    h((req) => {
      const { sentence, word, title, url, source } = req.body as { sentence?: string; word?: string; title?: string; url?: string; source?: string };
      const text = String(sentence ?? '').trim().slice(0, 400);
      if (!text) throw new Error('Sentence missing');
      const site = url ? new URL(url).hostname.replace(/^www\./, '') : (source ?? 'Text');
      const name = String(title ?? '').trim().slice(0, 80) || site;
      const moment: Moment = store.addMoment({
        id: store.newId(),
        kind: 'text',
        createdAt: new Date().toISOString(),
        status: 'ready',
        title: name,
        sourceLabel: name === site ? site : `${site} · ${name}`,
        hasAudio: false,
        hasImage: false,
        candidates: [{ start: 0, end: 0, text, source: 'text' }],
        targetHint: word?.trim() || undefined,
      });
      notify('mark', { moment });
      return moment;
    }),
  );

  /**
   * Text shared from the iPhone (an iOS Shortcut in the Share sheet: "Get contents of URL", POST, request body =
   * the shared text, or JSON {text, title}). Every Japanese sentence of it lands in the inbox.
   */
  r.post(
    '/share',
    express.text({ type: 'text/*', limit: '1mb' }),
    h((req) => {
      const raw = typeof req.body === 'string' ? req.body : String(req.body?.text ?? '');
      const sentences = splitSentences(raw);
      if (!sentences.length) throw new Error('No Japanese sentences found in that text');
      const title = String((req.body as { title?: string })?.title ?? req.query.title ?? 'Shared').slice(0, 80);
      for (const sentence of sentences)
        store.addMoment({
          id: store.newId(),
          kind: 'text',
          createdAt: new Date().toISOString(),
          status: 'ready',
          title,
          sourceLabel: title,
          hasAudio: false,
          hasImage: false,
          candidates: [{ start: 0, end: 0, text: sentence, source: 'text' }],
        });
      return { count: sentences.length };
    }),
  );

  /** Sentences saved in other tools (Language Reactor, asbplayer, any CSV/JSON) into the inbox. */
  r.post(
    '/import',
    h((req) => {
      const lines = parseImport(String(req.body?.text ?? ''));
      if (!lines.length) throw new Error('No Japanese sentences found in that file');
      const label = String(req.body?.name ?? 'Import').slice(0, 60);
      for (const l of lines.slice(0, 2000))
        store.addMoment({
          id: store.newId(),
          kind: 'text',
          createdAt: new Date().toISOString(),
          status: 'ready',
          title: l.source ?? label,
          sourceLabel: l.source ? `${label} · ${l.source}` : label,
          hasAudio: false,
          hasImage: false,
          candidates: [{ start: 0, end: 0, text: l.sentence, source: 'text' }],
          targetHint: l.word,
        });
      return { count: Math.min(lines.length, 2000) };
    }),
  );

  /** Article text for the reader (pages the phone cannot fetch itself because of CORS). */
  r.get('/fetch', h((req) => fetchArticle(String(req.query.url ?? ''))));

  /** Words read on a day (added up; the phone sends what it read since the last time). */
  r.post(
    '/read',
    h((req) => {
      const { day, words } = req.body as { day?: string; words?: number };
      if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !(Number(words) > 0)) throw new Error('day and words needed');
      const all = wordsReadByDay();
      all[day] = (all[day] ?? 0) + Math.min(Math.round(Number(words)), 200_000);
      writeJsonAtomic(READ_FILE, all);
      return { ok: true, today: all[day] };
    }),
  );

  return r;
}
