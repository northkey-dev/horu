import type { Printed } from './readings.ts';
// Card explanations: the prompt and the AI services that answer it. Runs on the laptop (server) and on the
// phone (PWA) alike, so it only uses fetch. `claude -p` lives in server/src/claude.ts because it needs a shell.

export type Explanation = {
  targetReading: string;
  targetMeaning: string;
  translation: string;
  explanation: string;
};

export type ExplainInput = { sentence: string; target: string; context: string[]; source: string; readings?: Printed[] };

/** Services that are called over HTTP with the user's own key (Ollama needs none). */
export type AiService = 'gemini' | 'anthropic' | 'openai' | 'ollama';

export type AiConfig = { service: AiService; key: string; model?: string; url?: string };

export const DEFAULT_MODELS: Record<AiService, string> = {
  gemini: 'gemini-flash-latest',
  anthropic: 'claude-haiku-5-5',
  openai: 'gpt-5-mini',
  ollama: 'qwen3:8b',
};

export const AI_LABELS: Record<AiService, string> = {
  gemini: 'Google Gemini (free key)',
  anthropic: 'Anthropic API key',
  openai: 'OpenAI API key',
  ollama: 'Ollama on the laptop',
};

/** Everything that can write an explanation on the laptop: Claude Code (`claude -p`) and the HTTP services. */
export type AiEngine = 'claude' | AiService;
export const AI_ENGINES: AiEngine[] = ['claude', 'gemini', 'anthropic', 'openai', 'ollama'];
export const ENGINE_LABELS: Record<AiEngine, string> = { claude: 'Claude Code (claude -p, your subscription)', ...AI_LABELS };

/** The order the laptop asks its AIs in: the first one, then the fallbacks. Unknown names and repeats are dropped. */
export function aiChain(primary: string, fallback: string): AiEngine[] {
  const chain: AiEngine[] = [];
  for (const name of [primary, ...fallback.split(',')].map((n) => n.trim())) {
    if ((AI_ENGINES as string[]).includes(name) && !chain.includes(name as AiEngine)) chain.push(name as AiEngine);
  }
  return chain.length ? chain : ['claude'];
}

export const DEFAULT_PROFILE = 'Around JLPT N4, some N3. Learned from a textbook, weak kanji. Goal: understand anime by ear and read manga.';

export const SCHEMA = {
  type: 'object',
  properties: {
    targetReading: { type: 'string', description: 'Hiragana reading of the target word in dictionary form' },
    targetMeaning: { type: 'string', description: 'Short English meaning of the target word as used here' },
    translation: { type: 'string', description: 'Natural English translation of the whole sentence' },
    explanation: { type: 'string', description: '2-4 sentences, at most 70 words, plain text' },
  },
  required: ['targetReading', 'targetMeaning', 'translation', 'explanation'],
  additionalProperties: false,
};

export function buildPrompt(input: ExplainInput, profile = DEFAULT_PROFILE): string {
  return [
    'You write the back side of a Japanese sentence-mining flashcard.',
    '',
    `Learner: ${profile.trim() || DEFAULT_PROFILE}`,
    '',
    `Source: ${input.source}`,
    input.context.length ? `Surrounding lines:\n${input.context.map((l) => `  ${l}`).join('\n')}` : '',
    `Sentence: ${input.sentence}`,
    printedLine(input.readings),
    `Target word: ${input.target}`,
    '',
    'Return JSON with:',
    '- targetReading: hiragana reading of the target word in dictionary form (the form in parentheses, if given)',
    '- targetMeaning: concise English meaning of the target word in this context (dictionary-style, max ~8 words)',
    '- translation: natural English translation of the sentence (use the context, keep the tone)',
    '- explanation: 2-4 complete English sentences, at most 70 words. Explain what this learner would miss: grammar',
    '  patterns, contractions and casual forms (e.g. ちゃう, じゃん, ってば), role language, dialect, nuance,',
    '  sentence-final particles, or why this word fits here. Relate to textbook forms when helpful.',
    '  Focus on the one or two points that matter most. Do not repeat the translation. Plain text, no markdown.',
    '',
    'Write in complete, well-formed English sentences regardless of any other style preferences.',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

/** The prompt for pasting into a chat app; asks for bare JSON so the answer can be pasted back. */
export function chatPrompt(input: ExplainInput, profile?: string): string {
  return `${buildPrompt(input, profile)}\n\nAnswer with only the JSON object, no other text.`;
}

/** Translation of a whole line, e.g. a manga speech bubble. */
export type WordNote = { word: string; reading: string; meaning: string };
export type Translation = { translation: string; notes: string; words?: WordNote[]; /** The laptop's id for this answer (rating, asking again) */ ref?: string };

export type TranslateInput = { text: string; context: string[]; source: string; readings?: Printed[]; wordByWord?: boolean };

/** What the page prints beats what a model remembers: 間 here is あいだ, whatever else it can be. */
const printedLine = (readings: Printed[] = []) =>
  readings.length ? `Furigana printed on the page: ${readings.map((r) => `${r.base}=${r.reading}`).join(', ')}. These are how the author wants it read: use exactly these readings everywhere in your answer and never say that one of them is read differently.` : '';

export const TRANSLATE_SCHEMA = {
  type: 'object',
  properties: {
    translation: { type: 'string', description: 'Natural English translation of the text' },
    notes: { type: 'string', description: 'At most two short sentences for the learner, or an empty string' },
    words: {
      type: 'array',
      description: 'The words of the text one by one, or an empty list',
      items: {
        type: 'object',
        properties: { word: { type: 'string' }, reading: { type: 'string' }, meaning: { type: 'string' } },
        required: ['word', 'reading', 'meaning'],
        additionalProperties: false,
      },
    },
  },
  required: ['translation', 'notes', 'words'],
  additionalProperties: false,
};

export function translatePrompt(input: TranslateInput, profile = DEFAULT_PROFILE): string {
  return [
    'Translate a line of Japanese for a learner.',
    '',
    `Learner: ${profile.trim() || DEFAULT_PROFILE}`,
    `Source: ${input.source}`,
    input.context.length ? `Lines before it:\n${input.context.map((l) => `  ${l}`).join('\n')}` : '',
    `Text: ${input.text}`,
    printedLine(input.readings),
    '',
    'The text may come from OCR of a manga page and contain small recognition errors; translate what was most likely meant.',
    'Return JSON with:',
    '- translation: natural English translation of the text (keep the tone; use the lines before it only as context)',
    '- notes: at most two short English sentences on what this learner would miss (casual or contracted forms,',
    '  grammar, nuance, an OCR error you corrected). Empty string if there is nothing worth saying.',
    input.wordByWord
      ? '- words: every word of the text that carries meaning, in order, without particles. For each: word (as written), reading (hiragana), meaning (short English; for an inflected word also its dictionary form and what the form does, e.g. "sold: past of 売る, to sell").'
      : '- words: an empty list',
    '',
    'Write in complete, well-formed English sentences regardless of any other style preferences.',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export function parseTranslation(text: string): Translation | undefined {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return undefined;
  try {
    const data = JSON.parse(match[0]) as Partial<Translation>;
    if (typeof data.translation !== 'string' || !data.translation.trim()) return undefined;
    const words = Array.isArray(data.words) ? data.words.filter((w) => typeof w?.word === 'string' && typeof w?.meaning === 'string').map((w) => ({ word: w.word, reading: String(w.reading ?? ''), meaning: w.meaning })) : [];
    return { translation: data.translation, notes: String(data.notes ?? ''), words };
  } catch {
    return undefined;
  }
}

/** Reads an explanation out of an answer that may wrap the JSON in prose or a code block. */
export function parseExplanation(text: string): Explanation | undefined {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return undefined;
  try {
    const data = JSON.parse(match[0]) as Partial<Explanation>;
    if (typeof data.explanation !== 'string' && typeof data.translation !== 'string') return undefined;
    return {
      targetReading: String(data.targetReading ?? ''),
      targetMeaning: String(data.targetMeaning ?? ''),
      translation: String(data.translation ?? ''),
      explanation: String(data.explanation ?? ''),
    };
  } catch {
    return undefined;
  }
}

const TIMEOUT_MS = 90_000;

async function call(url: string, init: RequestInit, label: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const e = err as Error;
    throw new Error(e.name === 'TimeoutError' ? `${label} did not answer within ${TIMEOUT_MS / 1000} s` : `${label} is not reachable: ${e.message}`);
  }
  const data = (await res.json().catch(() => undefined)) as { error?: { message?: string } | string } | undefined;
  if (!res.ok) {
    const reason = typeof data?.error === 'string' ? data.error : data?.error?.message;
    throw new Error(`${label}: ${reason ?? `HTTP ${res.status}`}`);
  }
  return data;
}

/** Asks one of the HTTP services for the explanation. */
export async function explainWith(config: AiConfig, input: ExplainInput, profile?: string): Promise<Explanation> {
  const { text, label } = await ask(config, buildPrompt(input, profile), SCHEMA);
  const result = parseExplanation(text);
  if (!result?.explanation) throw new Error(`${label} returned no explanation`);
  return result;
}

/** Asks one of the HTTP services for a translation. */
export async function translateWith(config: AiConfig, input: TranslateInput, profile?: string): Promise<Translation> {
  const { text, label } = await ask(config, translatePrompt(input, profile), TRANSLATE_SCHEMA);
  const result = parseTranslation(text);
  if (!result) throw new Error(`${label} returned no translation`);
  return result;
}

/** Sends a prompt that asks for JSON (`schema`) and returns the answer's text. */
async function ask(config: AiConfig, prompt: string, schema: object): Promise<{ text: string; label: string }> {
  const model = config.model?.trim() || DEFAULT_MODELS[config.service];
  const label = AI_LABELS[config.service].replace(/ \(.*\)$/, '');
  if (config.service !== 'ollama' && !config.key.trim()) throw new Error(`${label}: no API key set`);
  let text = '';
  if (config.service === 'gemini') {
    const data = (await call(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.key.trim() },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
        }),
      },
      label,
    )) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  } else if (config.service === 'anthropic') {
    const data = (await call(
      'https://api.anthropic.com/v1/messages',
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.key.trim(),
          'anthropic-version': '2023-06-01',
          // The phone calls the API directly with the user's own key.
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({ model, max_tokens: 1500, messages: [{ role: 'user', content: `${prompt}\n\nAnswer with only the JSON object.` }] }),
      },
      label,
    )) as { content?: { type: string; text?: string }[] };
    text = data.content?.map((c) => c.text ?? '').join('') ?? '';
  } else if (config.service === 'openai') {
    const data = (await call(
      'https://api.openai.com/v1/chat/completions',
      {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.key.trim()}` },
        body: JSON.stringify({ model, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] }),
      },
      label,
    )) as { choices?: { message?: { content?: string } }[] };
    text = data.choices?.[0]?.message?.content ?? '';
  } else {
    const base = (config.url?.trim() || 'http://127.0.0.1:11434').replace(/\/+$/, '');
    const data = (await call(
      `${base}/api/chat`,
      { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, stream: false, format: schema, messages: [{ role: 'user', content: prompt }] }) },
      label,
    )) as { message?: { content?: string } };
    text = data.message?.content ?? '';
  }
  return { text, label };
}
