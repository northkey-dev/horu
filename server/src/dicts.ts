import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, writeJsonAtomic } from './config.ts';
import { log } from './log.ts';
import { infoOf, lookupDicts, parseYomitan, type DictInfo, type YomitanDict } from '../../shared/yomitan.ts';

// Yomitan dictionaries the user imported (Settings → Dictionaries). One compact JSON per dictionary in
// data/dicts; loaded on the first lookup and kept in memory.

const DIR = path.join(DATA_DIR, 'dicts');
fs.mkdirSync(DIR, { recursive: true });
const ORDER = path.join(DIR, 'order.json');

let loaded: YomitanDict[] | undefined;

function order(): string[] {
  try {
    return JSON.parse(fs.readFileSync(ORDER, 'utf8')) as string[];
  } catch {
    return [];
  }
}

function load(): YomitanDict[] {
  if (loaded) return loaded;
  const ids = order();
  loaded = [];
  for (const id of ids) {
    try {
      loaded.push(JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8')) as YomitanDict);
    } catch (err) {
      log.warn(`Dictionary ${id} could not be read`, (err as Error).message);
    }
  }
  return loaded;
}

export function listDicts(): DictInfo[] {
  return load().map(infoOf);
}

export function importDict(zip: Buffer): DictInfo {
  const dict = parseYomitan(new Uint8Array(zip));
  // Compact: Jitendex alone is tens of megabytes.
  const file = path.join(DIR, `${dict.id}.json`);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(dict));
  fs.renameSync(`${file}.tmp`, file);
  writeJsonAtomic(ORDER, [...order().filter((id) => id !== dict.id), dict.id]);
  loaded = undefined;
  log.info(`Imported dictionary ${dict.title}`, dict.counts);
  return infoOf(dict);
}

export function removeDict(id: string): void {
  writeJsonAtomic(ORDER, order().filter((x) => x !== id));
  fs.rmSync(path.join(DIR, `${path.basename(id)}.json`), { force: true });
  loaded = undefined;
}

export function lookup(forms: string[]) {
  const dicts = load();
  return dicts.length ? lookupDicts(dicts, forms) : {};
}
