import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DATA_DIR, DICT_DIR, getSettings, writeJsonAtomic } from './config.ts';
import { downloadReleaseJson } from './download.ts';
import { invoke } from './anki.ts';
import { log } from './log.ts';
import { kanjiOf, type KanjiInfo } from '../../shared/kanji.ts';

// KANJIDIC: the fallback when JMdict has no word (meanings per character, readings for furigana), served
// to the phone like JMdict. Also optional kanji cards (Settings → "Kanji cards"): for every new kanji in a
// target word, one "Horu Kanji" note with meanings, readings and the word it came from.

const KANJI_FILE = path.join(DICT_DIR, 'kanjidic.json');
export const KANJI_GZ = KANJI_FILE + '.gz';
const DONE_FILE = path.join(DATA_DIR, 'kanji-cards.json');
const MODEL = 'Horu Kanji';

let kanjidic: Record<string, KanjiInfo> | undefined;
let loading: Promise<Record<string, KanjiInfo>> | undefined;

export function loadKanjidic(): Promise<Record<string, KanjiInfo>> {
  if (kanjidic) return Promise.resolve(kanjidic);
  loading ??= build().finally(() => (loading = undefined));
  return loading;
}

async function build(): Promise<Record<string, KanjiInfo>> {
  if (!fs.existsSync(KANJI_FILE)) {
    log.info('Downloading KANJIDIC…');
    const { bytes } = await downloadReleaseJson(/^kanjidic2-en-.*\.json\.zip$/);
    type Raw = {
      characters: {
        literal: string;
        misc: { jlptLevel: number | null; grade: number | null };
        readingMeaning: { groups: { readings: { type: string; value: string }[]; meanings: { lang: string; value: string }[] }[] } | null;
      }[];
    };
    const raw = JSON.parse(new TextDecoder().decode(bytes)) as Raw;
    const out: Record<string, KanjiInfo> = {};
    for (const c of raw.characters) {
      const groups = c.readingMeaning?.groups ?? [];
      const readings = groups.flatMap((g) => g.readings);
      out[c.literal] = {
        meanings: groups.flatMap((g) => g.meanings.filter((m) => m.lang === 'en').map((m) => m.value)).slice(0, 5),
        on: readings.filter((r) => r.type === 'ja_on').map((r) => r.value).slice(0, 4),
        kun: readings.filter((r) => r.type === 'ja_kun').map((r) => r.value).slice(0, 4),
        jlpt: c.misc.jlptLevel,
        grade: c.misc.grade,
      };
    }
    writeJsonAtomic(KANJI_FILE, out);
  }
  const json = fs.readFileSync(KANJI_FILE, 'utf8');
  if (!fs.existsSync(KANJI_GZ)) fs.writeFileSync(KANJI_GZ, zlib.gzipSync(json, { level: 9 }));
  kanjidic = JSON.parse(json) as Record<string, KanjiInfo>;
  return kanjidic;
}

/** Downloads KANJIDIC in the background so lookups never wait for it. */
export function ensureKanjidic(): void {
  loadKanjidic().catch((err) => log.warn('KANJIDIC not available', err));
}

/** KANJIDIC entries for the kanji in `text` (characters it does not know are left out). */
export async function kanjiInfo(text: string): Promise<Record<string, KanjiInfo>> {
  const dic = await loadKanjidic();
  return Object.fromEntries(kanjiOf(text).filter((k) => dic[k]).map((k) => [k, dic[k]]));
}

const FRONT = `<div class="kanji">{{Kanji}}</div>`;
const BACK = `{{FrontSide}}<hr id="answer">
<div class="meaning">{{Meanings}}</div>
<div class="readings"><span>音</span> {{Onyomi}}<br><span>訓</span> {{Kunyomi}}</div>
<div class="example">{{Example}}</div>`;
const CSS = `.card { font-family: "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif; text-align: center; background: #fafafa; color: #1d1d1f; }
.nightMode.card, .night_mode .card { background: #1e1e1e; color: #eee; }
.kanji { font-size: 96px; margin: 20px 0; }
.meaning { font-size: 22px; margin: 10px 0; }
.readings { font-size: 18px; color: #868e96; line-height: 1.8; }
.readings span { display: inline-block; font-size: 12px; border: 1px solid currentColor; border-radius: 4px; padding: 0 4px; }
.example { font-size: 18px; margin-top: 14px; }`;

async function ensureModel(): Promise<void> {
  const models = await invoke<string[]>('modelNames');
  if (models.includes(MODEL)) return;
  await invoke('createModel', {
    modelName: MODEL,
    inOrderFields: ['Kanji', 'Meanings', 'Onyomi', 'Kunyomi', 'Example'],
    css: CSS,
    isCloze: false,
    cardTemplates: [{ Name: 'Kanji', Front: FRONT, Back: BACK }],
  });
}

/** Adds kanji cards for kanji in `word` that never got one. Errors are logged, never thrown. */
export async function addKanjiCards(word: string, reading: string, sentence: string): Promise<number> {
  if (!getSettings().kanjiCards) return 0;
  try {
    const done = new Set<string>(fs.existsSync(DONE_FILE) ? JSON.parse(fs.readFileSync(DONE_FILE, 'utf8')) : []);
    const fresh = [...new Set(word.match(/[㐀-鿿]/g) ?? [])].filter((k) => !done.has(k));
    if (!fresh.length) return 0;
    const dic = await loadKanjidic();
    await ensureModel();
    const deck = `${getSettings().deckName}::Kanji`;
    await invoke('createDeck', { deck });
    let added = 0;
    for (const k of fresh) {
      const info = dic[k];
      if (!info) continue;
      await invoke('addNote', {
        note: {
          deckName: deck,
          modelName: MODEL,
          fields: {
            Kanji: k,
            Meanings: info.meanings.join(', '),
            Onyomi: info.on.join('、'),
            Kunyomi: info.kun.join('、'),
            Example: `${word}【${reading}】<br><span style="font-size:15px;color:#868e96">${sentence}</span>`,
          },
          options: { allowDuplicate: false },
          tags: ['horu', 'kanji'],
        },
      }).then(
        () => added++,
        (err: Error) => log.debug('Kanji note skipped', k, err.message),
      );
      done.add(k);
    }
    writeJsonAtomic(DONE_FILE, [...done]);
    return added;
  } catch (err) {
    log.warn('Kanji cards failed', err);
    return 0;
  }
}
