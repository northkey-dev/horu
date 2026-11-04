import type { IpadicFeatures, Tokenizer } from 'kuromoji';
// The prebuilt browser bundle; the package's main entry needs Node's `path`.
import kuromoji from 'kuromoji/build/kuromoji.js';
import { laptopUrl, servedByLaptop } from './laptop.ts';
import { alignReading, furiganaHtml, readingFromTokens, toHiragana } from '../../../shared/furigana.ts';
import { kanjiOf, type KanjiInfo } from '../../../shared/kanji.ts';

export { alignReading, toHiragana };
export type { KanjiInfo };

// Offline Japanese support for the PWA: tokenizer (kuromoji) + JMdict and KANJIDIC lookups.
// The tokenizer dictionary ships with the app; JMdict and KANJIDIC come from the laptop once and are kept in
// Cache Storage (the app build carries a copy of both for phones without a laptop).

export type Token = {
  surface: string;
  base: string;
  reading: string;
  pos: string;
  start: number;
  end: number;
};

/** [kanji forms "|"-joined, kana forms, common 0/1, senses " / "-joined, part of speech] */
type CompactEntry = [string, string, 0 | 1, string, string];

export type DictEntry = {
  kanji: string[];
  kana: string[];
  common: boolean;
  senses: string[];
  pos: string;
};

let tokenizerPromise: Promise<Tokenizer<IpadicFeatures>> | undefined;
export function getTokenizer(): Promise<Tokenizer<IpadicFeatures>> {
  tokenizerPromise ??= new Promise((resolve, reject) =>
    kuromoji.builder({ dicPath: 'dict/kuromoji/' }).build((err: Error | null, t: Tokenizer<IpadicFeatures>) => {
      if (err) {
        tokenizerPromise = undefined;
        reject(err);
      } else resolve(t);
    }),
  );
  return tokenizerPromise;
}

/**
 * The laptop answers in milliseconds, while the phone first has to load and unpack ~60 MB of tokenizer
 * and dictionary. So the laptop is asked first and the phone's own copy is only used when it is unreachable
 * (offline manga reading) or fails.
 */
async function viaLaptop<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(laptopUrl(path), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function tokenize(text: string): Promise<Token[]> {
  try {
    return await viaLaptop<Token[]>('/api/tokenize', { text });
  } catch {
    return tokenizeLocal(text);
  }
}

/** Card fields the laptop would compute: furigana HTML of the sentence and the reading of the target. */
export async function cardText(sentence: string, start: number, end: number, word: string): Promise<{ furigana: string; reading: string }> {
  const asParts = (list: Token[]) => list.map((t) => ({ surface: t.surface, reading: t.reading || undefined }));
  return { furigana: furiganaHtml(asParts(await tokenizeLocal(sentence)), start, end), reading: readingFromTokens(asParts(await tokenizeLocal(word))) };
}

async function tokenizeLocal(text: string): Promise<Token[]> {
  const t = await getTokenizer();
  let pos = 0;
  return t.tokenize(text).map((tok) => {
    const start = pos;
    pos += tok.surface_form.length;
    return {
      surface: tok.surface_form,
      base: tok.basic_form && tok.basic_form !== '*' ? tok.basic_form : tok.surface_form,
      reading: tok.reading && tok.reading !== '*' ? toHiragana(tok.reading) : '',
      pos: tok.pos,
      start,
      end: pos,
    };
  });
}

// ---- dictionary ----

const DICT_CACHE = 'horu-dict';
let index: Promise<Map<string, CompactEntry[]>> | undefined;

const dictMeta = () =>
  Promise.resolve()
    .then(() => fetch(laptopUrl('/dict/meta'), { signal: AbortSignal.timeout(3000) }))
    .then((r) => r.json() as Promise<{ state: string; version?: string }>)
    .catch(() => undefined);

/** Keeps one version of JMdict on the phone. */
async function keepDictionary(cache: Cache, key: string, res: Response): Promise<void> {
  for (const k of await cache.keys()) if (k.url.includes('/dict/jmdict.json')) await cache.delete(k);
  await cache.put(key, res);
}

async function fetchDictionary(): Promise<CompactEntry[]> {
  const meta = await dictMeta();
  const cache = 'caches' in self ? await caches.open(DICT_CACHE) : undefined;
  const key = `/dict/jmdict.json?v=${meta?.version ?? 'offline'}`;
  let res = await cache?.match(key);
  if (!res && meta?.state !== 'ready') {
    // Offline or still building on the laptop: use whatever version we have.
    const keys = (await cache?.keys()) ?? [];
    const any = keys.find((k) => k.url.includes('/dict/jmdict.json'));
    res = any ? await cache?.match(any) : undefined;
  }
  if (!res && !meta) {
    // No laptop: the copy that ships with the app.
    const text = await shippedText('dict/jmdict.json.gz');
    if (text !== undefined) {
      await cache?.put('/dict/jmdict.json?v=app', new Response(text, { headers: { 'Content-Type': 'application/json' } }));
      return JSON.parse(text) as CompactEntry[];
    }
  }
  if (!res) {
    // No copy on the phone and the laptop does not answer: asking again would only hang.
    if (!meta) throw new Error('Dictionary not available offline yet');
    const fresh = await fetch(laptopUrl('/dict/jmdict.json'));
    if (!fresh.ok) throw new Error('Dictionary not available yet');
    if (cache) await keepDictionary(cache, key, fresh.clone());
    res = fresh;
  }
  return res.json();
}

/** A gzipped file that ships with the app (GitHub Pages serves it without Content-Encoding). */
async function shippedText(file: string): Promise<string | undefined> {
  const shipped = await fetch(file).catch(() => undefined);
  if (!shipped?.ok) return undefined;
  const bytes = new Uint8Array(await shipped.arrayBuffer());
  const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
  return (gzipped ? new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))) : new Response(bytes)).text();
}

export function loadDictionary(): Promise<Map<string, CompactEntry[]>> {
  index ??= fetchDictionary()
    .then((entries) => {
      const map = new Map<string, CompactEntry[]>();
      for (const e of entries) {
        for (const form of (e[0] ? e[0].split('|') : []).concat(e[1].split('|'))) {
          if (!form) continue;
          const list = map.get(form);
          if (list) list.push(e);
          else map.set(form, [e]);
        }
      }
      return map;
    })
    .catch((err) => {
      index = undefined;
      throw err;
    });
  return index;
}

function expand(e: CompactEntry): DictEntry {
  return {
    kanji: e[0] ? e[0].split('|') : [],
    kana: e[1].split('|'),
    common: e[2] === 1,
    senses: e[3] ? e[3].split(' / ') : [],
    pos: e[4],
  };
}

export async function lookupForm(form: string): Promise<DictEntry[]> {
  const map = await loadDictionary();
  return (map.get(form) ?? []).slice(0, 5).map(expand);
}

export type Lookup = { text: string; form: string; start: number; end: number; entries: DictEntry[] };

/**
 * Yomitan-style lookup starting at token `i`: tries spans of up to 4 tokens
 * (longest first), each by surface and by dictionary form of the last token.
 */
export async function lookupAt(tokens: Token[], i: number): Promise<Lookup[]> {
  const candidates: { surface: string; form: string; start: number; end: number }[] = [];
  const seen = new Set<string>();
  for (let len = Math.min(4, tokens.length - i); len >= 1; len--) {
    const span = tokens.slice(i, i + len);
    const surface = span.map((t) => t.surface).join('');
    const withBase = span.slice(0, -1).map((t) => t.surface).join('') + span[len - 1].base;
    for (const form of [withBase, surface]) {
      if (seen.has(form)) continue;
      seen.add(form);
      candidates.push({ surface, form, start: span[0].start, end: span[len - 1].end });
    }
  }
  const found = await entriesFor(candidates.map((c) => c.form));
  return candidates
    .filter((c) => found.has(c.form))
    .map((c) => ({ text: c.surface, form: c.form, start: c.start, end: c.end, entries: found.get(c.form)!.slice(0, 4).map(expand) }));
}

/** Dictionary entries for the given forms (see viaLaptop for why the laptop goes first). */
async function entriesFor(forms: string[]): Promise<Map<string, CompactEntry[]>> {
  try {
    return new Map(Object.entries(await viaLaptop<Record<string, CompactEntry[]>>('/api/lookup', { forms })));
  } catch {
    const map = await loadDictionary();
    return new Map(forms.filter((f) => map.has(f)).map((f) => [f, map.get(f)!]));
  }
}

// ---- KANJIDIC ----

const KANJI_KEY = '/dict/kanjidic.json';
let kanjidic: Promise<Record<string, KanjiInfo>> | undefined;

function loadKanjidic(): Promise<Record<string, KanjiInfo>> {
  kanjidic ??= (async () => {
    const cache = 'caches' in self ? await caches.open(DICT_CACHE) : undefined;
    const cached = await cache?.match(KANJI_KEY);
    if (cached) return cached.json();
    const fresh = await Promise.resolve()
      .then(() => fetch(laptopUrl('/dict/kanjidic.json'), { signal: AbortSignal.timeout(20_000) }))
      .catch(() => undefined);
    const text = fresh?.ok ? await fresh.text() : await shippedText('dict/kanjidic.json.gz');
    if (text === undefined) throw new Error('Kanji dictionary not available offline yet');
    await cache?.put(KANJI_KEY, new Response(text, { headers: { 'Content-Type': 'application/json' } }));
    return JSON.parse(text) as Record<string, KanjiInfo>;
  })().catch((err) => {
    kanjidic = undefined;
    throw err;
  });
  return kanjidic;
}

/** KANJIDIC entries for the kanji in `text`; characters it does not know are left out. */
export async function kanjiInfo(text: string): Promise<Record<string, KanjiInfo>> {
  if (!kanjiOf(text).length) return {};
  try {
    return await viaLaptop<Record<string, KanjiInfo>>('/api/kanji', { text });
  } catch {
    const dic = await loadKanjidic();
    return Object.fromEntries(kanjiOf(text).filter((k) => dic[k]).map((k) => [k, dic[k]]));
  }
}

const CONTENT_POS = new Set(['名詞', '動詞', '形容詞', '副詞', '形容動詞', '感動詞']);

/**
 * Suggests a target word: the rarest content word (not marked "common" in JMdict),
 * falling back to the longest content word. Returns a span in the sentence.
 */
export async function suggestTarget(tokens: Token[], known?: Set<string>): Promise<{ start: number; end: number; form: string } | undefined> {
  const map = await loadDictionary().catch(() => undefined);
  let best: { start: number; end: number; form: string; score: number } | undefined;
  for (const tok of tokens) {
    if (!CONTENT_POS.has(tok.pos) || /^[぀-ゟ]$/.test(tok.surface) || /^[\d\s\p{P}]+$/u.test(tok.surface)) continue;
    const entries = map?.get(tok.base) ?? map?.get(tok.surface) ?? [];
    if (map && !entries.length) continue;
    const common = entries.some((e) => e[2] === 1);
    const hasKanji = /[㐀-鿿]/.test(tok.surface);
    const isKnown = known?.has(tok.base) || known?.has(tok.surface);
    const score = (isKnown ? 0 : 20) + (common ? 0 : 10) + (hasKanji ? 3 : 0) + Math.min(tok.surface.length, 4) + (tok.pos === '名詞' ? 0 : 1);
    if (!best || score > best.score) best = { start: tok.start, end: tok.end, form: tok.base, score };
  }
  return best && { start: best.start, end: best.end, form: best.form };
}

const KUROMOJI_CACHE = 'horu-kuromoji-v1'; // the service worker reads it, see sw.js
const KUROMOJI_FILES = ['base', 'cc', 'check', 'tid', 'tid_map', 'tid_pos', 'unk', 'unk_char', 'unk_compat', 'unk_invoke', 'unk_map', 'unk_pos'];

/**
 * An app that comes from the laptop has nowhere else to get these files once the laptop is off, so they are
 * stored while it answers. Stored only: nothing is unpacked into the phone's memory.
 */
async function storeForOffline(): Promise<void> {
  if (!('caches' in self)) return; // plain http in the home network
  const meta = await dictMeta();
  if (!meta) return;
  const tokenizer = await caches.open(KUROMOJI_CACHE);
  for (const name of KUROMOJI_FILES) {
    const url = `dict/kuromoji/${name}.dat.gz`;
    if (!(await tokenizer.match(url))) await tokenizer.add(url);
  }
  await loadKanjidic();
  if (meta.state !== 'ready') return;
  const cache = await caches.open(DICT_CACHE);
  const key = `/dict/jmdict.json?v=${meta.version}`;
  if (await cache.match(key)) return;
  const fresh = await fetch(laptopUrl('/dict/jmdict.json'));
  if (fresh.ok) await keepDictionary(cache, key, fresh);
}

/** Warm the phone's own copies in the background so offline reading is instant. */
export function preloadJapanese(): void {
  const idle = (cb: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(cb) : setTimeout(cb, 1500));
  if (servedByLaptop()) idle(() => void storeForOffline().catch(() => {}));
  // Only worth the phone's memory and battery if chapters are saved for offline reading.
  try {
    if (!Object.keys(JSON.parse(localStorage.getItem('horu-offline-chapters') ?? '{}')).length) return;
  } catch {
    return;
  }
  idle(() => {
    getTokenizer().catch(() => {});
    loadDictionary().catch(() => {});
    loadKanjidic().catch(() => {});
  });
}
