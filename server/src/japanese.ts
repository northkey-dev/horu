import path from 'node:path';
import { createRequire } from 'node:module';
import kuromoji from 'kuromoji';
import { furiganaHtml as furigana, readingFromTokens, toHiragana } from '../../shared/furigana.ts';

// Tokenizer + furigana for card HTML. Readings come from the IPA dictionary, which is reliable enough for
// ruby text and deterministic (no LLM).

const require = createRequire(import.meta.url);
const DIC_PATH = path.join(path.dirname(require.resolve('kuromoji/package.json')), 'dict');

let tokenizerPromise: Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>> | undefined;
export function tokenizer(): Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>> {
  tokenizerPromise ??= new Promise((resolve, reject) =>
    kuromoji.builder({ dicPath: DIC_PATH }).build((err, t) => (err ? reject(err) : resolve(t))),
  );
  return tokenizerPromise;
}

export { toHiragana };

const tokens = async (text: string) =>
  (await tokenizer()).tokenize(text).map((t) => ({ surface: t.surface_form, reading: t.reading && t.reading !== '*' ? t.reading : undefined }));

/** Sentence as HTML with <ruby> furigana and the target range wrapped in <b> (see shared/furigana.ts). */
export async function furiganaHtml(sentence: string, targetStart: number, targetEnd: number): Promise<string> {
  return furigana(await tokens(sentence), targetStart, targetEnd);
}

export async function readingOf(word: string): Promise<string> {
  return readingFromTokens(await tokens(word));
}
