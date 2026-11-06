import { speak, ttsOn } from './tts.ts';
import fs from 'node:fs';
import { cutClip } from './audio.ts';
import { ClaudeError, explain, translate } from './claude.ts';
import { AI_LABELS, DEFAULT_MODELS, ENGINE_LABELS, aiChain, buildPrompt, explainWith, translatePrompt, translateWith, type AiEngine, type ExplainInput, type Explanation, type TranslateInput, type Translation } from '../../shared/ai.ts';
import { aiKey, createAiLog, trainingLines } from './aiLog.ts';
import { ChainError, runChain } from './aiChain.ts';
import path from 'node:path';
import { highlight, slug } from '../../shared/furigana.ts';
import { notify } from './webhook.ts';
import { cardMade } from './knownWords.ts';
import { addToJpdb } from './jpdb.ts';
import { addNote } from './anki.ts';
import { furiganaHtml, readingOf } from './japanese.ts';
import { addKanjiCards } from './kanji.ts';
import { log } from './log.ts';
import { DATA_DIR, getSettings, writeJsonAtomic } from './config.ts';
import { readJsonKeepingDamaged } from './jsonFile.ts';
import * as store from './store.ts';
import type { CardRequest } from '../../shared/types.ts';

// Inbox item -> Anki note. Runs one card at a time (claude calls are the slow part).

let chain: Promise<unknown> = Promise.resolve();

export function createCard(id: string, req: CardRequest, opts: { skipAi?: boolean } = {}): void {
  const moment = store.getMoment(id);
  if (!moment) throw new Error('Unknown moment');
  if (!req.sentence.trim()) throw new Error('Sentence is empty');
  if (!(req.targetEnd > req.targetStart)) throw new Error('Pick a target word first');
  store.updateMoment(id, { status: 'creating', error: undefined });
  chain = chain.then(() =>
    build(id, req, opts).then(
      () => forget(id),
      (err: Error) => {
        // No AI answered (limit reached, offline, down): the card is not lost, it waits and is made when one does.
        if (isOutage(err) && !opts.skipAi) return wait(id, req, opts);
        forget(id);
        log.error('Card creation failed', err);
        store.updateMoment(id, { status: 'error', error: err.message });
      },
    ),
  );
}

type Waiting = { req: CardRequest; opts: { skipAi?: boolean }; since: number };
const WAITING_FILE = path.join(DATA_DIR, 'card-queue.json');
const waiting = new Map<string, Waiting>(Object.entries(readJsonKeepingDamaged<Record<string, Waiting>>(WAITING_FILE, () => ({}))));
const saveWaiting = () => writeJsonAtomic(WAITING_FILE, Object.fromEntries(waiting));
const isOutage = (err: Error) => err instanceof ChainError || (err instanceof ClaudeError && err.timedOut) || /did not answer|no API key|not reachable|limit/i.test(err.message);
/** Number of cards waiting for an AI. */
export const cardsWaiting = (): number => waiting.size;

function forget(id: string): void {
  if (waiting.delete(id)) saveWaiting();
}

function wait(id: string, req: CardRequest, opts: { skipAi?: boolean }): void {
  waiting.set(id, { req, opts, since: waiting.get(id)?.since ?? Date.now() });
  saveWaiting();
  log.warn(`Card ${id} waits for an AI`);
  store.updateMoment(id, { status: 'creating', error: 'No AI answered. Horu asks again every 5 minutes and makes the card as soon as one does. Discard it here if you do not want it.' });
}

function retryWaiting(): void {
  for (const [id, w] of [...waiting]) {
    const moment = store.getMoment(id);
    if (!moment || moment.status !== 'creating' || Date.now() - w.since > 3 * 86_400_000) {
      forget(id);
      continue;
    }
    try {
      createCard(id, w.req, w.opts);
    } catch (err) {
      log.warn('Waiting card could not start again:', (err as Error).message);
    }
  }
}
setInterval(retryWaiting, 5 * 60_000).unref();
setTimeout(retryWaiting, 90_000).unref();

async function build(id: string, req: CardRequest, opts: { skipAi?: boolean }): Promise<void> {
  const moment = store.getMoment(id)!;
  const sentence = req.sentence.trim();
  const target = sentence.slice(req.targetStart, req.targetEnd);

  let clip: string | undefined;
  // The wav is deleted once a card exists; the mp3 is good enough for cutting again after a restore.
  const source = [store.mediaPath(id, 'wav'), store.mediaPath(id, 'mp3')].find((f) => fs.existsSync(f));
  if (moment.hasAudio && source) {
    clip = store.mediaPath(id, 'clip.mp3');
    if (req.clipStart !== undefined && req.clipEnd !== undefined && moment.audioStart !== undefined) {
      await cutClip(source, req.clipStart - moment.audioStart, req.clipEnd - moment.audioStart, clip);
    } else {
      fs.copyFileSync(store.mediaPath(id, 'mp3'), clip);
    }
  }
  // Nothing to hear (manga, text, a photo): a computer voice reads the sentence. Without it the card is still a card.
  if (!clip && ttsOn()) {
    const voice = store.mediaPath(id, 'clip.mp3');
    await speak(sentence, voice, moment.readings).then(
      () => (clip = voice),
      (err: Error) => log.warn('Voice for the card failed', err.message),
    );
  }

  let ai: Explanation = req.explanation ?? { targetReading: '', targetMeaning: '', translation: '', explanation: '' };
  if (!opts.skipAi && !req.explanation) {
    const input = { sentence, target: req.targetDictForm && req.targetDictForm !== target ? `${target} (${req.targetDictForm})` : target, context: req.context, source: moment.sourceLabel, readings: moment.readings };
    try {
      ai = await explainOnLaptop(input);
    } catch (err) {
      // A timeout means Claude is down or rate-limited; retrying would only double the wait.
      if ((err instanceof ClaudeError && err.timedOut) || err instanceof ChainError) throw err;
      if (/did not answer|no API key/.test((err as Error).message)) throw err;
      log.warn('AI failed, retrying once', err);
      ai = await explainOnLaptop(input);
    }
  }
  if (!ai.targetReading) ai.targetReading = await readingOf(req.targetDictForm || target);

  const noteId = await addNote({
    sentence: highlight(sentence, req.targetStart, req.targetEnd),
    sentenceFurigana: await furiganaHtml(sentence, req.targetStart, req.targetEnd, moment.readings),
    target: req.targetDictForm || target,
    targetReading: ai.targetReading,
    targetMeaning: ai.targetMeaning,
    translation: ai.translation,
    explanation: ai.explanation,
    context: req.context.join('\n'),
    audioPath: clip,
    imagePath: moment.hasImage && (moment.kind !== 'anime' || getSettings().animeScreenshot) ? store.mediaPath(id, 'jpg') : undefined,
    source: moment.sourceLabel,
    mediaPrefix: `horu_${id}`,
    tags: [moment.kind, slug(moment.title)].filter(Boolean),
  });

  await addKanjiCards(req.targetDictForm || target, ai.targetReading, sentence);
  cardMade(req.targetDictForm || target);
  void addToJpdb(req.targetDictForm || target, sentence, ai.translation);

  store.updateMoment(id, {
    status: 'done',
    noteId,
    cardSentence: sentence,
    cardTarget: req.targetDictForm || target,
  });
  // Anki keeps its own copies; the rest stays for a few days (history → restore) and is purged later.
  store.removeFile(store.mediaPath(id, 'wav'));
  store.removeFile(store.mediaPath(id, 'clip.mp3'));
  log.info(`Card created for ${id} (note ${noteId})`);
  notify('card', { moment: store.getMoment(id), target: req.targetDictForm || target, sentence, ...ai });
}

// Every answer is kept in data/ai-log.jsonl (see aiLog.ts): the same request is answered from there, and the
// file is the training set for a small local model later. Settings → AI sets which AIs are asked, in which order.
export const aiLog = createAiLog(path.join(DATA_DIR, 'ai-log.jsonl'));

// When another AI had to answer for the first one, the app says so for a while (and stops saying it as soon as the
// first one answers again).
let fallbackNote: { at: number; text: string } | undefined;
const NOTE_MS = 20 * 60_000;
const nameOf = (e: string) => ENGINE_LABELS[e as AiEngine].replace(/ \(.*\)$/, '');
export const aiNote = (): string | undefined => (fallbackNote && Date.now() - fallbackNote.at < NOTE_MS ? fallbackNote.text : undefined);

type KeyEngine = 'gemini' | 'anthropic' | 'openai';
const KEY_OF = { gemini: 'aiKeyGemini', anthropic: 'aiKeyAnthropic', openai: 'aiKeyOpenai' } as const;
const MODEL_OF = { gemini: 'aiModelGemini', anthropic: 'aiModelAnthropic', openai: 'aiModelOpenai', ollama: 'aiModelOllama' } as const;

/** The engines in the order they are asked. */
const engineOrder = (): AiEngine[] => aiChain(getSettings().aiEngine, getSettings().aiFallback);
/** The model an engine uses (what the log and the cache tell apart). */
const modelOf = (engine: AiEngine): string => (engine === 'claude' ? getSettings().claudeModel : getSettings()[MODEL_OF[engine]] || DEFAULT_MODELS[engine]);
const notSetUp = (engine: string): string | undefined =>
  engine in KEY_OF && !getSettings()[KEY_OF[engine as KeyEngine]].trim() ? `${AI_LABELS[engine as KeyEngine].replace(/ \(.*\)$/, '')}: no API key set` : undefined;
const configOf = (engine: Exclude<AiEngine, 'claude'>) => {
  const s = getSettings();
  return { service: engine, key: engine === 'ollama' ? '' : s[KEY_OF[engine]], model: s[MODEL_OF[engine]], url: s.ollamaUrl };
};
const keyFor = (kind: 'explain' | 'translate', engine: AiEngine, parts: unknown[]) => aiKey(kind, engine, modelOf(engine), getSettings().learnerProfile, parts);

/** Asks the AIs in order and logs the answer of the one that gave it. A known request is answered without any. */
async function ask<I, O>(kind: 'explain' | 'translate', input: I, parts: unknown[], viaClaude: (i: I) => Promise<O>, via: (c: ReturnType<typeof configOf>, i: I, profile: string) => Promise<O>, fresh: boolean): Promise<{ output: O; ref: string }> {
  const engines = engineOrder();
  if (!fresh) {
    for (const engine of engines) {
      const key = keyFor(kind, engine, parts);
      const known = aiLog.find(key) as O | undefined;
      if (known) return { output: known, ref: key };
    }
  }
  const { engine, result } = await runChain(
    engines,
    (e) => (e === 'claude' ? viaClaude(input) : via(configOf(e as Exclude<AiEngine, 'claude'>), input, getSettings().learnerProfile)),
    notSetUp,
    (e, message) => log.warn(`${e} did not answer, trying the next AI:`, message),
  );
  fallbackNote = engine === engines[0] ? undefined : { at: Date.now(), text: `${nameOf(engines[0])} did not answer, so ${nameOf(engine)} is writing the explanations and translations.` };
  const key = keyFor(kind, engine as AiEngine, parts);
  aiLog.add(key, { t: new Date().toISOString(), kind, engine, model: modelOf(engine as AiEngine), profile: getSettings().learnerProfile, input, output: result });
  return { output: result, ref: key };
}

/** Explanation for a card; a known card text is not asked again. */
async function explainOnLaptop(input: ExplainInput): Promise<Explanation> {
  const { output } = await ask('explain', input, [input.sentence, input.target, input.context], explain, explainWith, false);
  return { ...output };
}

/** Translation of a line (manga speech bubble, text); a known line comes back at once unless `fresh` asks again. */
export async function translateOnLaptop(input: TranslateInput, fresh = false): Promise<Translation> {
  const { output, ref } = await ask('translate', input, [input.text, input.wordByWord === true], translate, translateWith, fresh);
  return { ...output, ref };
}

/** Counts for Settings: all answers and how many are rated. */
export function aiLogStats(): { count: number; good: number; bad: number } {
  const all = aiLog.all();
  return { count: all.length, good: all.filter((e) => e.rating === 1).length, bad: all.filter((e) => e.rating === -1).length };
}

/** The log as chat examples for teaching a model (one JSON line each). Rated: only the answers marked good. */
export function aiExamples(rated: boolean): string {
  const lines = trainingLines(aiLog.all(), (e) => (e.kind === 'explain' ? buildPrompt(e.input as ExplainInput, e.profile) : translatePrompt(e.input as TranslateInput, e.profile)), rated);
  return lines.length ? `${lines.join('\n')}\n` : '';
}

/** An answer a phone got from its own key: kept like the laptop's own, so the log is complete. */
export function recordPhoneAnswer(body: Record<string, unknown>): void {
  const kind = body.kind === 'explain' || body.kind === 'translate' ? body.kind : undefined;
  const input = body.input as Record<string, unknown> | undefined;
  if (!kind || !input || typeof input !== 'object' || !body.output) throw new Error('Nothing to record');
  const engine = String(body.engine ?? '').slice(0, 40);
  const model = String(body.model ?? '').slice(0, 80);
  const profile = String(body.profile ?? '').slice(0, 2000);
  const parts = kind === 'explain' ? [input.sentence, input.target, input.context] : [input.text, input.wordByWord === true];
  const key = aiKey(kind, engine, model, profile, parts);
  if (aiLog.find(key)) return;
  aiLog.add(key, { t: new Date().toISOString(), kind, engine: `${engine} (phone)`, model, profile, input, output: body.output });
}
