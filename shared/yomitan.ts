import { strFromU8, unzipSync } from 'fflate';

// Yomitan dictionaries (Jitendex, JPDB/Innocent frequency lists, Kanjium pitch accent …): a zip with
// index.json, term_bank_*.json and term_meta_bank_*.json. Turned into a compact lookup table that the laptop
// keeps on disk and the phone in IndexedDB. Kanji banks are skipped.

export type YomitanDict = {
  id: string;
  title: string;
  revision: string;
  /** term → [reading, glossary as plain text][] */
  terms: Record<string, [string, string][]>;
  /** term → frequency rank (lower = more common) */
  freq: Record<string, number>;
  /** term → [reading, downstep positions][] */
  pitch: Record<string, [string, number[]][]>;
  counts: { terms: number; freq: number; pitch: number };
};

export type DictInfo = Pick<YomitanDict, 'id' | 'title' | 'revision' | 'counts'>;

/** What the word sheet shows for one form, merged over all dictionaries. */
export type DictHit = {
  defs: { dict: string; reading: string; gloss: string }[];
  freq?: { dict: string; rank: number };
  pitch?: { reading: string; positions: number[] }[];
};

const MAX_GLOSS = 280;

/** Plain text of a glossary item (string, {type:'text'}, or structured content with nested tags). */
function textOf(node: unknown): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (!node || typeof node !== 'object') return '';
  const n = node as { type?: string; text?: string; tag?: string; content?: unknown; data?: Record<string, string> };
  if (n.type === 'text') return n.text ?? '';
  if (n.type === 'image' || n.tag === 'img' || n.tag === 'rt' || n.tag === 'rp') return '';
  // Jitendex wraps attribution and example sentences in data-content blocks; keep the meaning only.
  if (n.data?.content && /attribution|example|forms|xref|antonym/.test(n.data.content)) return '';
  const inner = textOf(n.content);
  if (n.tag === 'li') return `${inner}; `;
  if (n.tag === 'div' || n.tag === 'br' || n.tag === 'ol' || n.tag === 'ul') return ` ${inner} `;
  return inner;
}

const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/(;\s*)+$/, '').replace(/\s+;/g, ';').trim();

function rankOf(data: unknown): number | undefined {
  if (typeof data === 'number') return data;
  if (typeof data === 'string') return Number.parseInt(data, 10) || undefined;
  if (data && typeof data === 'object') {
    const d = data as { value?: number; frequency?: unknown; displayValue?: string };
    if (typeof d.value === 'number') return d.value;
    if (d.frequency !== undefined) return rankOf(d.frequency);
  }
  return undefined;
}

export function parseYomitan(zip: Uint8Array): YomitanDict {
  const files = unzipSync(zip, { filter: (f) => f.name === 'index.json' || /^term(_meta)?_bank_\d+\.json$/.test(f.name.split('/').pop() ?? '') });
  const indexFile = Object.keys(files).find((f) => f.endsWith('index.json'));
  if (!indexFile) throw new Error('Not a Yomitan dictionary (index.json missing)');
  const index = JSON.parse(strFromU8(files[indexFile])) as { title?: string; revision?: string };
  const title = index.title?.trim() || 'Dictionary';
  const dict: YomitanDict = {
    id: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dict',
    title,
    revision: String(index.revision ?? ''),
    terms: {},
    freq: {},
    pitch: {},
    counts: { terms: 0, freq: 0, pitch: 0 },
  };
  for (const [name, bytes] of Object.entries(files)) {
    const base = name.split('/').pop() ?? '';
    if (base.startsWith('term_bank_')) {
      for (const row of JSON.parse(strFromU8(bytes)) as unknown[][]) {
        const [term, reading, , , , glossary] = row as [string, string, string, string, number, unknown[]];
        const gloss = clean(glossary.map((g) => clean(textOf(g))).filter(Boolean).join(' / ')).slice(0, MAX_GLOSS);
        if (!term || !gloss) continue;
        const list = (dict.terms[term] ??= []);
        // Some dictionaries split one word over several rows; keep a few.
        if (list.length < 4) list.push([reading || term, gloss]);
        dict.counts.terms++;
      }
    } else if (base.startsWith('term_meta_bank_')) {
      for (const row of JSON.parse(strFromU8(bytes)) as unknown[][]) {
        const [term, mode, data] = row as [string, string, unknown];
        if (mode === 'freq') {
          const rank = rankOf(data);
          if (rank !== undefined && (dict.freq[term] === undefined || rank < dict.freq[term])) {
            dict.freq[term] = rank;
            dict.counts.freq++;
          }
        } else if (mode === 'pitch') {
          const d = data as { reading: string; pitches?: { position: number }[] };
          (dict.pitch[term] ??= []).push([d.reading, (d.pitches ?? []).map((p) => p.position)]);
          dict.counts.pitch++;
        }
      }
    }
  }
  if (!dict.counts.terms && !dict.counts.freq && !dict.counts.pitch) throw new Error('This dictionary has no word entries (kanji-only dictionaries are not supported)');
  return dict;
}

export const infoOf = (d: YomitanDict): DictInfo => ({ id: d.id, title: d.title, revision: d.revision, counts: d.counts });

/** Looks the forms up in all dictionaries (in the given order). */
export function lookupDicts(dicts: YomitanDict[], forms: string[]): Record<string, DictHit> {
  const out: Record<string, DictHit> = {};
  for (const form of forms) {
    const hit: DictHit = { defs: [] };
    for (const d of dicts) {
      for (const [reading, gloss] of d.terms[form] ?? []) hit.defs.push({ dict: d.title, reading, gloss });
      if (!hit.freq && d.freq[form] !== undefined) hit.freq = { dict: d.title, rank: d.freq[form] };
      if (!hit.pitch && d.pitch[form]) hit.pitch = d.pitch[form].map(([reading, positions]) => ({ reading, positions }));
    }
    if (hit.defs.length || hit.freq || hit.pitch) out[form] = hit;
  }
  return out;
}

/** Downstep position as the usual name: 0 heiban, 1 atamadaka, = mora count odaka, else nakadaka. */
export function pitchName(reading: string, position: number): string {
  const morae = reading.replace(/[ゃゅょャュョぁぃぅぇぉァィゥェォ]/g, '').length;
  if (position === 0) return 'heiban';
  if (position === 1) return 'atamadaka';
  if (position === morae) return 'odaka';
  return 'nakadaka';
}
