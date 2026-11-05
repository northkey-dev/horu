import fs from 'node:fs';
import { createHash } from 'node:crypto';

// Every answer the AI gave on the laptop (card explanations, translations), one JSON line each in
// data/ai-log.jsonl. It does two jobs: asking for the same thing again is answered from here at once, and
// the file is a ready set of (input, output) pairs to teach a small local model later.
//
// Two kinds of lines: an answer ({key, t, kind, engine, model, profile, input, output}) and a rating of an
// earlier answer ({key, rating: 1 | -1}). A later answer for the same key replaces the earlier one.

export type AiRecord = {
  t: string;
  kind: 'explain' | 'translate';
  /** Who answered: claude, gemini, anthropic, openai, ollama */
  engine: string;
  model: string;
  /** The learner text that went into the prompt, so the pair stands on its own */
  profile: string;
  input: unknown;
  output: unknown;
};

export type AiEntry = AiRecord & { key: string; rating?: 1 | -1 };

/** What makes two requests the same: same kind, same AI and model, same learner text, same input. */
export function aiKey(kind: AiRecord['kind'], engine: string, model: string, profile: string, parts: unknown[]): string {
  const hash = createHash('sha1').update(JSON.stringify([kind, engine, model, profile.trim(), parts])).digest('hex');
  return hash.slice(0, 20);
}

export function createAiLog(file: string) {
  let entries: Map<string, AiEntry> | undefined;

  function load(): Map<string, AiEntry> {
    if (entries) return entries;
    entries = new Map();
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return entries; // no log yet
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as Partial<AiEntry> & { key?: string };
        if (!row.key) continue;
        if (row.kind) entries.set(row.key, row as AiEntry);
        else if (row.rating === 1 || row.rating === -1) {
          const entry = entries.get(row.key);
          if (entry) entry.rating = row.rating;
        }
      } catch {
        // a half-written last line (power cut): skip it, the rest stays good
      }
    }
    return entries;
  }

  function append(row: unknown): void {
    try {
      fs.appendFileSync(file, JSON.stringify(row) + '\n');
    } catch (err) {
      // A full disk must not break a card.
      console.warn('Could not write the AI log:', (err as Error).message);
    }
  }

  return {
    /** The earlier answer for this key, or undefined. */
    find(key: string): unknown {
      return load().get(key)?.output;
    },
    /** Remembers the answer and appends it to the file. */
    add(key: string, rec: AiRecord): void {
      load().set(key, { key, ...rec });
      append({ key, ...rec });
    },
    /** Marks an answer good (1) or bad (-1). False when the key is unknown. */
    rate(key: string, rating: 1 | -1): boolean {
      const entry = load().get(key);
      if (!entry) return false;
      entry.rating = rating;
      append({ key, rating });
      return true;
    },
    /** All answers, oldest first. */
    all: (): AiEntry[] => [...load().values()],
    size: () => load().size,
  };
}

/**
 * The log as training examples, one chat per line: what the AI was asked and what it answered.
 * `rated` keeps only answers marked good; otherwise everything not marked bad.
 */
export function trainingLines(items: AiEntry[], prompt: (e: AiEntry) => string, rated = false): string[] {
  return items
    .filter((e) => (rated ? e.rating === 1 : e.rating !== -1))
    .map((e) => JSON.stringify({ messages: [{ role: 'user', content: prompt(e) }, { role: 'assistant', content: JSON.stringify(e.output) }], engine: e.engine, kind: e.kind }));
}
