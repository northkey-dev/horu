import { chatPrompt, DEFAULT_PROFILE, explainWith, translatePrompt, translateWith, type AiService, type ExplainInput, type Explanation, type TranslateInput, type Translation } from '../../../shared/ai.ts';
import { escapeHtml, highlight, slug } from '../../../shared/furigana.ts';
import { BACK, CSS, FIELDS, FRONT, MODEL_NAME } from '../../../shared/notetype.ts';
import type { CardRequest, Moment, Settings } from '../../../shared/types.ts';
import { buildApkg, loadSql, type ApkgNote } from './apkg.ts';
import { cardText } from './japanese.ts';
import { downsample, toWav } from './mic.ts';
import { recall, remember, mirroredMedia } from './mirror.ts';
import { api, laptopUp } from './api.ts';
import { laptopUrl } from './laptop.ts';
import { translatesAhead, wordByWord } from './phone.ts';

// Cards made on the phone. The laptop stays the default when it is reachable (its Anki, its AI); without it
// the phone builds the card itself and sends it to one of these:
//   apkg         collected on the phone, exported as an .apkg file (with audio and image) and opened in
//                AnkiMobile / AnkiDroid / Anki; also CSV and JSON
//   ankiconnect  AnkiConnect on the phone itself (AnkiConnect Android) or another computer
//   ankimobile   AnkiMobile's add-note link, one card at a time, text only
// The explanation comes from an AI service called with the user's own key, or from any chat app via
// "copy prompt" and pasting the answer back.

export type CardTarget = 'auto' | 'laptop' | 'apkg' | 'ankiconnect' | 'ankimobile';
export type PhoneAi = 'auto' | 'laptop' | 'gemini' | 'anthropic' | 'openai' | 'copy' | 'none';
type KeyService = Exclude<AiService, 'ollama'>;

export type CardPrefs = {
  target: CardTarget;
  ai: PhoneAi;
  keys: Partial<Record<KeyService, string>>;
  models: Partial<Record<KeyService, string>>;
  /** Deck for cards built on the phone; empty = the laptop's deck */
  deck: string;
  ankiConnectUrl: string;
  /** Learner description for the prompt; empty = the laptop's */
  profile: string;
  /** Learned from the laptop: its Horu note type id and deck, so .apkg imports land in the same place */
  laptopModelId?: number;
  laptopDeck?: string;
  laptopProfile?: string;
};

const PREFS = 'horu-cards';
const DEFAULTS: CardPrefs = { target: 'auto', ai: 'auto', keys: {}, models: {}, deck: '', ankiConnectUrl: 'http://127.0.0.1:8765', profile: '' };

export function cardPrefs(): CardPrefs {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(PREFS) ?? '{}') as Partial<CardPrefs>) };
  } catch {
    return DEFAULTS;
  }
}

export function setCardPrefs(patch: Partial<CardPrefs>): void {
  try {
    localStorage.setItem(PREFS, JSON.stringify({ ...cardPrefs(), ...patch }));
  } catch {
    // storage blocked
  }
  dispatchEvent(new Event('horu-cards'));
  if ((patch.target ?? cardPrefs().target) !== 'laptop') warmUp();
}

export const deckName = (p = cardPrefs()) => p.deck.trim() || p.laptopDeck || 'Horu';

/** Where this card goes: the laptop when it can take it, otherwise what the phone was set to. */
export function cardRoute(laptopUp: boolean, p = cardPrefs()): Exclude<CardTarget, 'auto'> {
  if (p.target === 'auto') return laptopUp ? 'laptop' : 'apkg';
  return p.target;
}

/** Who writes the explanation. `laptop` only when the card is made there. */
export function aiRoute(route: Exclude<CardTarget, 'auto'>, p = cardPrefs()): Exclude<PhoneAi, 'auto'> {
  if (p.ai === 'laptop') return route === 'laptop' ? 'laptop' : firstKey(p) ?? 'copy';
  if (p.ai !== 'auto') return p.ai;
  if (route === 'laptop') return 'laptop';
  return firstKey(p) ?? 'copy';
}

const firstKey = (p: CardPrefs) => (['gemini', 'anthropic', 'openai'] as const).find((s) => p.keys[s]?.trim());

export const profile = (p = cardPrefs()) => p.profile.trim() || p.laptopProfile || DEFAULT_PROFILE;

export function explainInput(moment: Moment, req: CardRequest): ExplainInput {
  const target = req.sentence.slice(req.targetStart, req.targetEnd);
  return {
    sentence: req.sentence.trim(),
    target: req.targetDictForm && req.targetDictForm !== target ? `${target} (${req.targetDictForm})` : target,
    context: req.context,
    source: moment.sourceLabel,
    readings: moment.readings,
  };
}

export const promptFor = (moment: Moment, req: CardRequest) => chatPrompt(explainInput(moment, req), profile());

export async function explainOnPhone(service: KeyService, moment: Moment, req: CardRequest): Promise<Explanation> {
  const p = cardPrefs();
  return explainWith({ service, key: p.keys[service] ?? '', model: p.models[service] }, explainInput(moment, req), profile(p));
}

/**
 * Translation of a whole line (a manga speech bubble) by the same AI the cards use: the service picked in
 * Settings, else the laptop's AI when it is reachable, else the first key on the phone. Without any, the
 * prompt is copied for a chat app and 'copied' comes back.
 */
export async function translateLine(line: TranslateInput): Promise<Translation | 'copied'> {
  const p = cardPrefs();
  const input = { ...line, wordByWord: wordByWord() };
  const key = `${input.wordByWord ? 'w' : ''}${input.text}`;
  const cache = `horu-tr:${key}`;
  const running = translating.get(key);
  if (running) return running;
  try {
    const hit = sessionStorage.getItem(cache);
    if (hit) return JSON.parse(hit) as Translation;
  } catch {
    // storage blocked
  }
  const service = translationService(p);
  if (!service) {
    await navigator.clipboard.writeText(`${translatePrompt(input, profile(p))}\n\nAnswer with only the JSON object, no other text.`);
    return 'copied';
  }
  const run = (service === 'laptop' ? api.translate(input) : translateWith({ service, key: p.keys[service] ?? '', model: p.models[service] }, input, profile(p)))
    .then((result) => {
      try {
        sessionStorage.setItem(cache, JSON.stringify(result));
      } catch {
        // storage full or blocked
      }
      return result;
    })
    .finally(() => translating.delete(key));
  translating.set(key, run);
  return run;
}

/** Translations under way, so a press on Translate joins the one started ahead instead of asking twice. */
const translating = new Map<string, Promise<Translation>>();

function translationService(p: CardPrefs) {
  const chosen = p.ai === 'gemini' || p.ai === 'anthropic' || p.ai === 'openai' ? p.ai : undefined;
  return chosen ?? (laptopUp() && p.ai !== 'copy' ? ('laptop' as const) : p.ai === 'copy' ? undefined : firstKey(p));
}

/**
 * Starts translating a line the moment it is opened (Settings → This phone). Without an AI nothing happens: the
 * copy-prompt route belongs to a press on Translate, it would overwrite the clipboard. A failure stays silent, the
 * press asks again and shows it.
 */
export function translateAhead(input: TranslateInput): void {
  if (translatesAhead() && translationService(cardPrefs())) translateLine(input).catch(() => undefined);
}

/** Remembers what the laptop said about its Anki, for cards the phone builds later. */
export function learnFromLaptop(info: { id?: number; deck?: string }, settings?: Settings): void {
  const p = cardPrefs();
  const next = { laptopModelId: info.id ?? p.laptopModelId, laptopDeck: info.deck ?? p.laptopDeck, laptopProfile: settings?.learnerProfile ?? p.laptopProfile };
  if (next.laptopModelId !== p.laptopModelId || next.laptopDeck !== p.laptopDeck || next.laptopProfile !== p.laptopProfile) setCardPrefs(next);
}

// ---- building the card ----

type Media = { name: string; data: Uint8Array };
type Built = { guid: string; word: string; sentence: string; fields: Record<string, string>; tags: string[]; media: Media[] };

async function blobOf(url: string): Promise<Blob | undefined> {
  const local = await mirroredMedia(url);
  const res = await fetch(local ?? url, { signal: AbortSignal.timeout(15_000) }).catch(() => undefined);
  if (local) URL.revokeObjectURL(local);
  return res?.ok ? res.blob() : undefined;
}

/** Cuts [from, to] seconds out of an audio file (wav or mp3) into a mono WAV. */
async function cutClip(blob: Blob, from: number, to: number): Promise<Blob> {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  const start = Math.max(0, Math.floor(from * buf.sampleRate));
  const end = Math.min(buf.length, Math.ceil(to * buf.sampleRate));
  const mono = new Float32Array(Math.max(0, end - start));
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const data = buf.getChannelData(c).subarray(start, end);
    for (let i = 0; i < mono.length; i++) mono[i] += data[i] / buf.numberOfChannels;
  }
  const rate = Math.min(buf.sampleRate, 24000);
  return toWav(downsample(mono, buf.sampleRate, rate), rate);
}

/** A computer voice from the laptop for a card without sound; a card without it is fine too. */
async function laptopVoice(text: string, readings: Moment['readings']): Promise<Blob | undefined> {
  if (!laptopUp()) return undefined;
  try {
    const res = await fetch(laptopUrl('/api/tts'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, readings }),
      signal: AbortSignal.timeout(20_000),
    });
    return res.ok ? await res.blob() : undefined;
  } catch {
    return undefined;
  }
}

async function build(moment: Moment, req: CardRequest, ai: Explanation | undefined, media: { audio?: string; image?: string }): Promise<Built> {
  const sentence = req.sentence.trim();
  const target = sentence.slice(req.targetStart, req.targetEnd);
  const word = req.targetDictForm || target;
  const { furigana, reading } = await cardText(sentence, req.targetStart, req.targetEnd, word, moment.readings);
  const files: Media[] = [];
  let audio = '';
  let image = '';
  const sound = media.audio && moment.hasAudio ? await blobOf(media.audio) : undefined;
  if (sound) {
    const clip =
      req.clipStart !== undefined && req.clipEnd !== undefined && moment.audioStart !== undefined
        ? await cutClip(sound, req.clipStart - moment.audioStart, req.clipEnd - moment.audioStart).catch(() => sound)
        : sound;
    const name = `horu_${moment.id}.${clip.type.includes('mpeg') ? 'mp3' : 'wav'}`;
    files.push({ name, data: new Uint8Array(await clip.arrayBuffer()) });
    audio = `[sound:${name}]`;
  } else {
    const voice = await laptopVoice(sentence, moment.readings);
    if (voice) {
      const name = `horu_${moment.id}.mp3`;
      files.push({ name, data: new Uint8Array(await voice.arrayBuffer()) });
      audio = `[sound:${name}]`;
    }
  }
  const settings = (await recall<Settings>('settings'))?.value;
  const picture = media.image && moment.hasImage && (moment.kind !== 'anime' || settings?.animeScreenshot) ? await blobOf(media.image) : undefined;
  if (picture) {
    const name = `horu_${moment.id}.jpg`;
    files.push({ name, data: new Uint8Array(await picture.arrayBuffer()) });
    image = `<img src="${name}">`;
  }
  const fields: Record<string, string> = {
    Sentence: highlight(sentence, req.targetStart, req.targetEnd),
    SentenceFurigana: furigana,
    Target: escapeHtml(word),
    TargetReading: escapeHtml(ai?.targetReading || reading),
    TargetMeaning: escapeHtml(ai?.targetMeaning ?? ''),
    Translation: escapeHtml(ai?.translation ?? ''),
    Explanation: escapeHtml(ai?.explanation ?? ''),
    Context: escapeHtml(req.context.join('\n')),
    Audio: audio,
    Image: image,
    Source: escapeHtml(moment.sourceLabel),
  };
  return { guid: `horu-${moment.id}`, word, sentence, fields, tags: ['horu', moment.kind, slug(moment.title)].filter(Boolean), media: files };
}

/**
 * Builds the card on the phone and hands it to the chosen target. Returns an AnkiMobile link to open for
 * `ankimobile` (the caller opens it, it needs the tap's user gesture on iOS).
 */
export async function makeCardOnPhone(
  moment: Moment,
  req: CardRequest,
  ai: Explanation | undefined,
  route: 'apkg' | 'ankiconnect' | 'ankimobile',
  media: { audio?: string; image?: string },
): Promise<{ word: string; sentence: string; link?: string }> {
  const card = await build(moment, req, ai, route === 'ankimobile' ? {} : media);
  if (route === 'apkg') await queueCard(card);
  else if (route === 'ankiconnect') await sendToAnkiConnect(card);
  else return { word: card.word, sentence: card.sentence, link: ankiMobileLink(card) };
  return { word: card.word, sentence: card.sentence };
}

// ---- AnkiMobile link ----

function ankiMobileLink(card: Built): string {
  const params = new URLSearchParams({ type: MODEL_NAME, deck: deckName(), tags: card.tags.join(' ') });
  for (const f of FIELDS) if (card.fields[f]) params.set(`fld${f}`, card.fields[f]);
  // AnkiMobile wants %20, not +, for spaces.
  return `anki://x-callback-url/addnote?${params.toString().replace(/\+/g, '%20')}`;
}

// ---- AnkiConnect (Android app or another computer) ----

async function ankiConnect<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const url = cardPrefs().ankiConnectUrl.trim() || DEFAULTS.ankiConnectUrl;
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', body: JSON.stringify({ action, version: 6, params }), signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new Error(`AnkiConnect at ${url} does not answer. Is the app running, and is ${location.origin} in its allowed origins (webCorsOriginList)?`);
  }
  const data = (await res.json()) as { result: T; error: string | null };
  if (data.error) throw new Error(`AnkiConnect ${action}: ${data.error}`);
  return data.result;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function sendToAnkiConnect(card: Built): Promise<void> {
  if (!(await ankiConnect<string[]>('modelNames')).includes(MODEL_NAME))
    await ankiConnect('createModel', { modelName: MODEL_NAME, inOrderFields: FIELDS, css: CSS, isCloze: false, cardTemplates: [{ Name: 'Sentence', Front: FRONT, Back: BACK }] });
  await ankiConnect('createDeck', { deck: deckName() });
  for (const file of card.media) await ankiConnect('storeMediaFile', { filename: file.name, data: toBase64(file.data) });
  await ankiConnect('addNote', { note: { deckName: deckName(), modelName: MODEL_NAME, fields: card.fields, tags: card.tags, options: { allowDuplicate: true } } });
}

// ---- export queue (.apkg / CSV / JSON) ----

type Queued = ApkgNote & { word: string; sentence: string; at: string; exportedAt?: string };
const QUEUE = 'card-queue';
const COUNT = 'horu-card-queue';

async function queue(): Promise<Queued[]> {
  return (await recall<Queued[]>(QUEUE))?.value ?? [];
}

async function saveQueue(list: Queued[]): Promise<void> {
  await remember(QUEUE, list);
  try {
    localStorage.setItem(COUNT, String(list.filter((c) => !c.exportedAt).length));
  } catch {
    // count only feeds the badge
  }
  dispatchEvent(new Event('horu-cards'));
}

async function queueCard(card: Built): Promise<void> {
  const list = (await queue()).filter((c) => c.guid !== card.guid);
  await saveQueue([{ ...card, at: new Date().toISOString() }, ...list]);
}

/** Cards waiting for the next export (kept in localStorage so screens can show it without waiting). */
export function queuedCount(): number {
  return Number(localStorage.getItem(COUNT) ?? 0) || 0;
}

/** Words with a card that waits on this phone or was exported from it. */
export const queuedWords = async () => (await queue()).map((c) => c.word);

export async function queueSummary(): Promise<{ waiting: number; exported: number; words: string[] }> {
  const list = await queue();
  const waiting = list.filter((c) => !c.exportedAt);
  return { waiting: waiting.length, exported: list.length - waiting.length, words: waiting.slice(0, 6).map((c) => c.word) };
}

export type ExportFormat = 'apkg' | 'csv' | 'json';

const csvCell = (s: string) => `"${s.replace(/"/g, '""')}"`;
const plain = (html: string) => html.replace(/<br\s*\/?>/g, ' ').replace(/<[^>]*>/g, '');

/** Builds the file for the waiting cards (or, with `again`, for the last exported ones). */
export async function exportCards(format: ExportFormat, again = false): Promise<{ file: File; count: number }> {
  const list = await queue();
  let cards = list.filter((c) => !c.exportedAt);
  if (again || !cards.length) {
    const last = list.map((c) => c.exportedAt).filter(Boolean).sort().pop();
    cards = list.filter((c) => c.exportedAt === last);
  }
  if (!cards.length) throw new Error('No cards to export');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  let file: File;
  if (format === 'apkg') {
    const p = cardPrefs();
    file = new File([await buildApkg(cards.slice().reverse(), { deck: deckName(p), modelId: p.laptopModelId })], `horu-${stamp}.apkg`, { type: 'application/octet-stream' });
  } else if (format === 'csv') {
    const cols = ['Sentence', 'Target', 'TargetReading', 'TargetMeaning', 'Translation', 'Explanation', 'Context', 'Source'];
    const rows = cards.map((c) => cols.map((f) => csvCell(plain(c.fields[f] ?? ''))).join(','));
    file = new File([`${cols.join(',')}\n${rows.join('\n')}\n`], `horu-${stamp}.csv`, { type: 'text/csv' });
  } else {
    const json = cards.map((c) => ({ id: c.guid, at: c.at, tags: c.tags, fields: c.fields, media: c.media.map((m) => m.name) }));
    file = new File([JSON.stringify(json, null, 2)], `horu-${stamp}.json`, { type: 'application/json' });
  }
  return { file, count: cards.length };
}

/** After a successful share or download: these cards count as exported; old exported ones are dropped. */
export async function markExported(count: number): Promise<void> {
  const now = new Date().toISOString();
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  let left = count;
  const list = (await queue()).map((c) => (!c.exportedAt && left-- > 0 ? { ...c, exportedAt: now } : c));
  await saveQueue(list.filter((c) => !c.exportedAt || c.exportedAt > weekAgo));
}

/** Opens the share sheet (AnkiMobile, Files, …) or downloads the file. Returns false if the user cancelled. */
export async function shareFile(file: File): Promise<boolean> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return true;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return false;
    }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

/** Loads SQLite while online, so an .apkg can be built offline later. */
function warmUp(): void {
  const idle = (cb: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(cb) : setTimeout(cb, 2000));
  idle(() => void loadSql().catch(() => undefined));
}
if (cardPrefs().target !== 'laptop') warmUp();
