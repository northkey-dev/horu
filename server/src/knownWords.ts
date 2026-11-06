import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, DICT_DIR, getSettings, writeJsonAtomic } from './config.ts';
import { exampleScore, isFiller } from './wordrank.ts';
import { cardsFor, existingTargets, MODEL_NAME, ankiOnline } from './anki.ts';
import { lookupIndex } from './dict.ts';
import { readingOf, tokenizer } from './japanese.ts';
import { log } from './log.ts';
import { isUnderstood, type WordState, type WordStatus } from '../../shared/words.ts';
import { jpdbKnown, parseJlptCsv, wanikaniKnown } from '../../shared/knownSources.ts';

// Estimate of the words the user already knows. Sources:
//  - Anki: every reviewed card (Minna no Nihongo, WaniKani, …) – Japanese words in its fields
//  - Horu cards: their target word once the card has been reviewed (and at once, as status, when made)
//  - jpdb.io and WaniKani (API key), word lists the user imports
//  - JLPT N5 + N4 vocabulary (open-anki-jlpt-decks, MIT) as a baseline
//  - word status the user sets in the app (1-4, known, ignore), which overrides the rest

const FILE = path.join(DATA_DIR, 'known.json');

export type ImportSource = 'jpdb' | 'wanikani' | 'list';
type KnownDb = {
  anki: string[];
  ankiRefreshedAt?: string;
  status: Record<string, WordStatus>;
  imported: Partial<Record<ImportSource, { words: string[]; at: string }>>;
};

const db: KnownDb = (() => {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Partial<KnownDb> & { manual?: string[]; unknown?: string[] };
    const status: Record<string, WordStatus> = { ...raw.status };
    // Before word status there were two lists: words marked known and words marked not known.
    for (const w of raw.manual ?? []) status[w] ??= 4;
    for (const w of raw.unknown ?? []) status[w] ??= 0;
    return { anki: raw.anki ?? [], ankiRefreshedAt: raw.ankiRefreshedAt, status, imported: raw.imported ?? {} };
  } catch {
    return { anki: [], status: {}, imported: {} };
  }
})();

let jlpt: string[] = [];
let cache: Set<string> | undefined;

const JP_RUN = /[぀-ヿ㐀-鿿々〆ー]+/g;

function save(): void {
  cache = undefined;
  writeJsonAtomic(FILE, db);
}

async function loadJlpt(): Promise<void> {
  if (jlpt.length) return;
  const words: string[] = [];
  for (const level of ['n5', 'n4']) {
    const file = path.join(DICT_DIR, `jlpt-${level}.csv`);
    if (!fs.existsSync(file)) {
      const fetched = await fetch(`https://raw.githubusercontent.com/jamsinclair/open-anki-jlpt-decks/main/src/${level}.csv`)
        .then((r) => (r.ok ? r.text() : undefined))
        .catch(() => undefined);
      if (fetched) fs.writeFileSync(file, fetched);
    }
    if (fs.existsSync(file)) words.push(...parseJlptCsv(fs.readFileSync(file, 'utf8')));
  }
  jlpt = words;
}

/** Re-reads known words from Anki (at most every 12 h unless forced). */
export async function refreshFromAnki(force = false): Promise<number> {
  if (!force && db.ankiRefreshedAt && Date.now() - Date.parse(db.ankiRefreshedAt) < 12 * 3600_000) return db.anki.length;
  if (!(await ankiOnline())) return db.anki.length;
  const query = getSettings().knownWordsQuery.trim();
  const cards = await cardsFor(`${query ? `(${query}) ` : ''}-is:new -is:suspended`);
  const index = lookupIndex();
  const words = new Set<string>();
  for (const card of cards) {
    if (card.modelName === MODEL_NAME) {
      // Horu cards: the target word counts once it has been reviewed a few days.
      if (card.interval >= 3) words.add(stripHtml(card.fields.Target?.value ?? ''));
      continue;
    }
    for (const field of Object.values(card.fields)) {
      for (const run of stripHtml(field.value).match(JP_RUN) ?? []) {
        // Only exact dictionary words – sentences in grammar decks would add noise.
        if (run.length <= 8 && (!index || index.has(run))) words.add(run);
      }
    }
  }
  db.anki = [...words].filter(Boolean);
  db.ankiRefreshedAt = new Date().toISOString();
  save();
  log.info(`Known words from Anki: ${db.anki.length} (from ${cards.length} reviewed cards)`);
  return db.anki.length;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\[[^\]]*\]/g, '').replace(/&nbsp;/g, ' ');
}

/** Words that count as understood: every source, plus status known/ignore, minus words set back to 0-3. */
export async function knownSet(): Promise<Set<string>> {
  if (cache) return cache;
  if (getSettings().jlptBaseline) await loadJlpt();
  const set = new Set<string>([...db.anki, ...(getSettings().jlptBaseline ? jlpt : []), ...Object.values(db.imported).flatMap((i) => i?.words ?? [])]);
  for (const [w, s] of Object.entries(db.status)) {
    if (isUnderstood(s)) set.add(w);
    else set.delete(w);
  }
  cache = set;
  return set;
}

/** Status the user set by hand (word → status). */
export const statusMap = (): Readonly<Record<string, WordStatus>> => db.status;

export function setStatus(word: string, status: WordStatus | null): void {
  if (status === null) delete db.status[word];
  else db.status[word] = status;
  save();
}

/** Kept for older phones: "Know it" = known, off = new. */
export const setKnown = (word: string, known: boolean) => setStatus(word, known ? 4 : 0);

/** A card was made for this word: it counts as known unless the user said otherwise. */
export function cardMade(word: string): void {
  if (!word || db.status[word] !== undefined) return;
  db.status[word] = 4;
  save();
}

export function importWords(source: ImportSource, words: string[]): number {
  db.imported[source] = { words: [...new Set(words)], at: new Date().toISOString() };
  save();
  return db.imported[source]!.words.length;
}

/** Re-pulls jpdb / WaniKani with the keys from Settings (with the Anki refresh, at most every 12 h). */
export async function refreshServices(force = false): Promise<void> {
  const s = getSettings();
  const due = (src: ImportSource) => force || !db.imported[src] || Date.now() - Date.parse(db.imported[src]!.at) > 12 * 3600_000;
  if (s.wanikaniToken.trim() && due('wanikani')) importWords('wanikani', await wanikaniKnown(s.wanikaniToken));
  if (s.jpdbApiKey.trim() && due('jpdb')) importWords('jpdb', await jpdbKnown(s.jpdbApiKey));
}

export function knownSummary() {
  const statuses = Object.values(db.status);
  return {
    anki: db.anki.length,
    manual: statuses.filter((s) => s === 4).length,
    ignored: statuses.filter((s) => s === -1).length,
    learning: statuses.filter((s) => s >= 1 && s <= 3).length,
    jlpt: jlpt.length,
    imported: Object.fromEntries(Object.entries(db.imported).map(([k, v]) => [k, { count: v?.words.length ?? 0, at: v?.at }])),
    ankiRefreshedAt: db.ankiRefreshedAt,
  };
}

/** Everything the phone needs to judge words offline. */
export async function wordState(): Promise<WordState> {
  return { known: [...(await knownSet())].filter((w) => db.status[w] === undefined), status: db.status, at: new Date().toISOString() };
}

// ---- text analysis ----

const CONTENT_POS = new Set(['名詞', '動詞', '形容詞', '副詞', '連体詞', '感動詞']);
const SKIP_DETAIL = new Set(['固有名詞', '数', '代名詞', '非自立', '接尾', 'サ変接続']);

/** Difficulty of a text and the most frequent new words in it (shared by the episode and chapter previews). */
export async function primingFor(lines: string[], limit = getSettings().prepWordCount) {
  const { coverage, tokens, words } = await analyse(lines);
  const unknown = words.filter((w) => !w.known);
  const priming = unknown.filter((w) => w.meaning && !isFiller(w)).slice(0, Math.min(30, Math.max(5, limit || 12)));
  // Words that already have a card (not reviewed yet, so still "unknown") are flagged; only asks Anki when it is running.
  if (priming.length && (await ankiOnline())) {
    const have = await existingTargets(priming.map((w) => w.word)).catch(() => new Set<string>());
    for (const w of priming) if (have.has(w.word)) w.inAnki = true;
  }
  return { coverage, tokens, uniqueWords: words.length, unknownWords: unknown.length, priming };
}

export type WordStat = { word: string; reading: string; count: number; known: boolean; meaning?: string; example?: string; inAnki?: boolean; pos?: string };

/** Counts content words (dictionary form) in a text, marks which are known. */
export async function analyse(lines: string[]): Promise<{ coverage: number; tokens: number; words: WordStat[] }> {
  const t = await tokenizer();
  const known = await knownSet();
  const index = lookupIndex();
  const stats = new Map<string, WordStat>();
  const exampleScores = new Map<string, number>();
  let tokens = 0;
  let knownTokens = 0;
  for (const line of lines) {
    for (const tok of t.tokenize(line.replace(/\n/g, ''))) {
      if (!CONTENT_POS.has(tok.pos) || SKIP_DETAIL.has(tok.pos_detail_1)) continue;
      const base = tok.basic_form && tok.basic_form !== '*' ? tok.basic_form : tok.surface_form;
      if (/^[぀-ゟ]$/.test(base) || !/[぀-ヿ㐀-鿿]/.test(base)) continue;
      if (index && !index.has(base)) continue;
      const reading = toHira(tok.reading && tok.reading !== '*' ? tok.reading : base);
      const isKnown = known.has(base) || known.has(tok.surface_form) || (base !== reading && known.has(reading) && !/[㐀-鿿]/.test(base));
      tokens++;
      if (isKnown) knownTokens++;
      const s = stats.get(base);
      const example = line.replace(/\n/g, ' ');
      const score = exampleScore(example, base, tok.surface_form);
      if (s) {
        s.count++;
        if (score > (exampleScores.get(base) ?? -Infinity)) {
          s.example = example;
          exampleScores.set(base, score);
        }
      } else {
        stats.set(base, { word: base, reading, count: 1, known: isKnown, example, pos: tok.pos });
        exampleScores.set(base, score);
      }
    }
  }
  const words = [...stats.values()].sort((a, b) => b.count - a.count);
  for (const w of words.filter((x) => !x.known).slice(0, 40)) {
    const entry = index?.get(w.word)?.[0];
    if (entry) w.meaning = entry[3].split(' / ').slice(0, 2).join('; ');
    // Reading of the dictionary form (the token reading belongs to the inflected surface).
    w.reading = await readingOf(w.word);
  }
  return { coverage: tokens ? knownTokens / tokens : 0, tokens, words };
}

function toHira(text: string): string {
  return text.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}
