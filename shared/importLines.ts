// Sentences saved in other tools (Language Reactor saved items, asbplayer / Migaku exports, any CSV or JSON)
// imported into the inbox, where they become cards like any mined line.

export type ImportedLine = { sentence: string; word?: string; source?: string };

const JP = /[぀-ヿ㐀-鿿]/;
const SENTENCE_KEYS = ['sentence', 'context', 'subtitle', 'text', 'line', 'example', 'expression', 'front'];
const WORD_KEYS = ['word', 'term', 'lemma', 'target', 'vocab', 'vocabulary'];
const SOURCE_KEYS = ['source', 'title', 'video', 'show', 'url'];

/** Value of the first column named like one of `keys` (exact names first, then names containing one). */
function pick(row: Record<string, unknown>, keys: string[], exact = false): string | undefined {
  const lower = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase().replace(/[^a-z]/g, ''), v]));
  const order = [...keys.map((k) => (name: string) => name === k), ...(exact ? [] : keys.map((k) => (name: string) => name.includes(k)))];
  for (const match of order) {
    const hit = Object.entries(lower).find(([name]) => match(name));
    if (hit && typeof hit[1] === 'string' && hit[1].trim()) return hit[1].trim();
    if (hit && hit[1] && typeof hit[1] === 'object' && 'text' in (hit[1] as object)) return String((hit[1] as { text: unknown }).text).trim();
  }
  return undefined;
}

/** Splits one CSV/TSV line, honouring double quotes. */
function cells(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) out.push(cur), (cur = '');
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const stripHtml = (s: string) => s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();

export function parseImport(text: string): ImportedLine[] {
  const trimmed = text.trim();
  let rows: Record<string, unknown>[] = [];
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const data = JSON.parse(trimmed) as unknown;
    const list = Array.isArray(data) ? data : ((Object.values(data as object).find(Array.isArray) as unknown[]) ?? []);
    rows = list.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object');
  } else {
    const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
    const sep = (lines[0].match(/\t/g)?.length ?? 0) > 0 ? '\t' : ',';
    const head = cells(lines[0], sep);
    const hasHeader = head.some((h) => [...SENTENCE_KEYS, ...WORD_KEYS].some((k) => h.toLowerCase().includes(k)));
    if (hasHeader) rows = lines.slice(1).map((l) => Object.fromEntries(cells(l, sep).map((v, i) => [head[i] ?? `c${i}`, v])));
    else {
      // No header: the longest Japanese cell is the sentence, a short one before it the word.
      for (const l of lines) {
        const jp = cells(l, sep).filter((c) => JP.test(c));
        if (!jp.length) continue;
        const sentence = jp.reduce((a, b) => (b.length > a.length ? b : a));
        const word = jp.find((c) => c !== sentence && c.length <= 12);
        rows.push({ sentence, word });
      }
    }
  }
  const out: ImportedLine[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const sentence = stripHtml(pick(r, SENTENCE_KEYS) ?? '');
    if (!JP.test(sentence) || seen.has(sentence)) continue;
    seen.add(sentence);
    const word = stripHtml(pick(r, WORD_KEYS) ?? '');
    out.push({ sentence: sentence.slice(0, 400), word: word && JP.test(word) && word !== sentence ? word : undefined, source: pick(r, SOURCE_KEYS, true)?.slice(0, 80) });
  }
  return out;
}
