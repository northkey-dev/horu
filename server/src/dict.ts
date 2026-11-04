import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DICT_DIR } from './config.ts';
import { downloadReleaseJson } from './download.ts';
import { log } from './log.ts';

// Builds a compact JMdict (English) for the PWA's offline dictionary from
// https://github.com/scriptin/jmdict-simplified. Built once, then served gzipped.

export const DICT_FILE = path.join(DICT_DIR, 'jmdict.json');
export const DICT_GZ = DICT_FILE + '.gz';
const META_FILE = path.join(DICT_DIR, 'meta.json');

/** [kanji forms "|"-joined, kana forms, common 0/1, senses " / "-joined, part of speech] */
export type CompactEntry = [string, string, 0 | 1, string, string];

type JmWord = {
  kanji: { text: string; common: boolean }[];
  kana: { text: string; common: boolean }[];
  sense: { partOfSpeech: string[]; gloss: { text: string }[] }[];
};

let building: Promise<void> | undefined;

export function dictMeta(): { version: string; count: number } | undefined {
  try {
    return JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
  } catch {
    return undefined;
  }
}

export function dictState(): 'ready' | 'building' | 'missing' {
  if (fs.existsSync(DICT_GZ) && dictMeta()) return 'ready';
  return building ? 'building' : 'missing';
}

export function ensureDictionary(): Promise<void> {
  if (dictState() === 'ready') return Promise.resolve();
  building ??= build()
    .catch((err) => log.error('Dictionary build failed', err))
    .finally(() => (building = undefined));
  return building;
}

async function build(): Promise<void> {
  log.info('Downloading JMdict…');
  const { tag, bytes: jsonBytes } = await downloadReleaseJson(/^jmdict-eng-\d.*\.json\.zip$/);
  const words = (JSON.parse(new TextDecoder().decode(jsonBytes)) as { words: JmWord[] }).words;

  const entries: CompactEntry[] = words.map((w) => {
    const common = w.kanji.some((k) => k.common) || w.kana.some((k) => k.common);
    const senses = w.sense
      .slice(0, 4)
      .map((s) => s.gloss.slice(0, 3).map((g) => g.text).join('; '))
      .filter(Boolean);
    return [
      w.kanji.map((k) => k.text).join('|'),
      w.kana.map((k) => k.text).join('|'),
      common ? 1 : 0,
      senses.join(' / '),
      (w.sense[0]?.partOfSpeech ?? []).join(','),
    ];
  });
  // Common words first so lookups list them first.
  entries.sort((a, b) => b[2] - a[2]);

  const json = JSON.stringify(entries);
  fs.writeFileSync(DICT_FILE, json);
  fs.writeFileSync(DICT_GZ, zlib.gzipSync(json, { level: 9 }));
  fs.writeFileSync(META_FILE, JSON.stringify({ version: tag, count: entries.length }));
  log.info(`JMdict ready: ${entries.length} entries (${(fs.statSync(DICT_GZ).size / 1e6).toFixed(1)} MB gz)`);
}

// ---- server-side lookups (used for known-word estimation and suggestions) ----

let index: Map<string, CompactEntry[]> | undefined;
export function lookupIndex(): Map<string, CompactEntry[]> | undefined {
  if (index) return index;
  if (!fs.existsSync(DICT_FILE)) return undefined;
  const entries = JSON.parse(fs.readFileSync(DICT_FILE, 'utf8')) as CompactEntry[];
  index = new Map();
  for (const e of entries) {
    for (const form of [...e[0].split('|'), ...e[1].split('|')]) {
      if (!form) continue;
      const list = index.get(form);
      if (list) list.push(e);
      else index.set(form, [e]);
    }
  }
  return index;
}
