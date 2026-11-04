import { zipSync } from 'fflate';
import { BACK, CSS, FIELDS, FRONT, MODEL_NAME } from '../../../shared/notetype.ts';

// Anki package (.apkg) built on the phone: a zip with an SQLite collection (legacy schema 11, which every
// Anki version still imports, AnkiMobile included) plus the media files. SQLite runs as WebAssembly (sql.js),
// loaded only when a package is built.

export type ApkgNote = {
  /** Stable per moment, so importing the same card twice updates it instead of adding a copy. */
  guid: string;
  fields: Record<string, string>;
  tags: string[];
  media: { name: string; data: Uint8Array }[];
};

/** Used when the laptop's Anki never told the phone its id for the note type. */
const FALLBACK_MODEL_ID = 1761955200000;

const SCHEMA = `
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null,
  dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null,
  dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null,
  tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null,
  usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null,
  factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null,
  odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null,
  lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`;

const DECK_OPTIONS = {
  1: {
    id: 1,
    name: 'Default',
    mod: 0,
    usn: 0,
    maxTaken: 60,
    autoplay: true,
    timer: 0,
    replayq: true,
    new: { bury: true, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 7], order: 1, perDay: 20, separate: true },
    lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
    rev: { bury: true, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, minSpace: 1, perDay: 200 },
  },
};

function deck(id: number, name: string, mod: number) {
  return { id, name, mod, usn: -1, desc: '', dyn: 0, conf: 1, collapsed: false, extendNew: 10, extendRev: 50, newToday: [0, 0], revToday: [0, 0], lrnToday: [0, 0], timeToday: [0, 0] };
}

/** Same deck name → same id, so repeated exports go to one deck. */
function deckId(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.codePointAt(0)!) >>> 0;
  return 1_500_000_000_000 + h;
}

async function checksum(text: string): Promise<number> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text)));
  return ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0;
}

const stripHtml = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

let sql: Promise<import('sql.js').SqlJsStatic> | undefined;
/** Loads SQLite (≈1 MB); called early so an export also works offline later. */
export function loadSql(): Promise<import('sql.js').SqlJsStatic> {
  sql ??= Promise.all([import('sql.js'), import('sql.js/dist/sql-wasm-browser.wasm?url')])
    .then(([{ default: init }, { default: wasm }]) => init({ locateFile: () => wasm }))
    .catch((e) => {
      sql = undefined;
      throw e;
    });
  return sql;
}

export async function buildApkg(notes: ApkgNote[], opts: { deck: string; modelId?: number }): Promise<Blob> {
  const SQL = await loadSql();
  const db = new SQL.Database();
  const now = Date.now();
  const sec = Math.floor(now / 1000);
  const mid = opts.modelId ?? FALLBACK_MODEL_ID;
  const did = deckId(opts.deck);
  const model = {
    id: mid,
    name: MODEL_NAME,
    type: 0,
    mod: sec,
    usn: -1,
    sortf: 0,
    did,
    tmpls: [{ name: 'Sentence', ord: 0, qfmt: FRONT, afmt: BACK, did: null, bqfmt: '', bafmt: '' }],
    flds: FIELDS.map((name, ord) => ({ name, ord, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] })),
    css: CSS,
    latexPre: '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
    latexPost: '\\end{document}',
    latexsvg: false,
    req: [[0, 'any', [FIELDS.indexOf('SentenceFurigana'), FIELDS.indexOf('Audio')]]],
    tags: [],
    vers: [],
  };
  const conf = { activeDecks: [1], addToCur: true, collapseTime: 1200, curDeck: 1, curModel: String(mid), dueCounts: true, estTimes: true, newBury: true, newSpread: 0, nextPos: notes.length + 1, sortBackwards: false, sortType: 'noteFld', timeLim: 0 };
  try {
    db.run(SCHEMA);
    db.run('INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, ?)', [
      sec,
      now,
      now,
      JSON.stringify(conf),
      JSON.stringify({ [mid]: model }),
      JSON.stringify({ 1: deck(1, 'Default', sec), [did]: deck(did, opts.deck, sec) }),
      JSON.stringify(DECK_OPTIONS),
      '{}',
    ]);
    const media: Record<string, string> = {};
    const files: Record<string, Uint8Array> = {};
    for (const [i, note] of notes.entries()) {
      const flds = FIELDS.map((f) => note.fields[f] ?? '').join('\x1f');
      const sort = stripHtml(note.fields[FIELDS[0]] ?? '');
      db.run('INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, ?)', [now + i, note.guid, mid, sec, ` ${note.tags.join(' ')} `, flds, sort, await checksum(sort), '']);
      db.run('INSERT INTO cards VALUES (?, ?, ?, 0, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, ?)', [now + i, now + i, did, sec, i + 1, '']);
      for (const file of note.media) {
        const n = String(Object.keys(media).length);
        media[n] = file.name;
        files[n] = file.data;
      }
    }
    const zip = zipSync({ 'collection.anki2': db.export(), media: new TextEncoder().encode(JSON.stringify(media)), ...files }, { level: 0 });
    return new Blob([zip], { type: 'application/octet-stream' });
  } finally {
    db.close();
  }
}
