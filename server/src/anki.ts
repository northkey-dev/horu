import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getSettings } from './config.ts';
import { log } from './log.ts';
import { BACK, CSS, FIELDS, FRONT, MODEL_NAME } from '../../shared/notetype.ts';

export { MODEL_NAME };

// AnkiConnect client (add-on 2055492159). Anki Desktop must be running; we start
// it minimised on demand. Cards reach the iPhone through AnkiWeb sync.

const URL = process.env.HORU_ANKI_URL ?? 'http://127.0.0.1:8765';

/**
 * Whether this Horu can make Anki cards itself: on a computer with Anki, or when HORU_ANKI_URL points at one.
 * In a container (Raspberry Pi) without such an address it cannot: the phone makes the cards instead.
 */
export const cardsHere = (): boolean => !process.env.HORU_DOCKER || Boolean(process.env.HORU_ANKI_URL);

export async function invoke<T>(action: string, params: Record<string, unknown> = {}, attempt = 0): Promise<T> {
  let res: Response;
  try {
    res = await fetch(URL, {
      method: 'POST',
      body: JSON.stringify({ action, version: 6, params }),
      signal: AbortSignal.timeout(action === 'sync' ? 120_000 : 15_000),
    });
  } catch (err) {
    // fetch only says "fetch failed"; say what actually is unreachable.
    throw new Error(`Anki is not reachable (AnkiConnect ${action}): ${(err as Error & { cause?: Error }).cause?.message ?? (err as Error).message}`);
  }
  const data = (await res.json()) as { result: T; error: string | null };
  // Anki briefly locks the collection while it syncs or opens a profile; the same call works a moment later.
  if (data.error && /lifecycle operation/i.test(data.error) && attempt < 8) {
    await new Promise((r) => setTimeout(r, 2000));
    return invoke<T>(action, params, attempt + 1);
  }
  if (data.error) throw new Error(`AnkiConnect ${action}: ${data.error}`);
  return data.result;
}

export async function ankiOnline(): Promise<boolean> {
  try {
    await invoke('version');
    return true;
  } catch {
    return false;
  }
}

/** How to start Anki on this system: [command, args], or undefined when it is not installed. */
function ankiLauncher(): [string, string[]] | undefined {
  if (process.platform === 'darwin') return fs.existsSync('/Applications/Anki.app') ? ['open', ['-a', 'Anki']] : undefined;
  if (process.platform !== 'win32') return ['anki', []];
  const candidates = [
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Anki', 'anki.exe'),
    path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Anki', 'anki.exe'),
  ];
  const exe = candidates.find((p) => fs.existsSync(p));
  return exe ? [exe, []] : undefined;
}

let starting: Promise<void> | undefined;
export function ensureAnki(): Promise<void> {
  starting ??= (async () => {
    if (await ankiOnline()) return;
    // Anki lives on another computer (HORU_ANKI_URL) or nowhere (container): there is nothing to start here.
    if (process.env.HORU_ANKI_URL || process.env.HORU_DOCKER) {
      throw new Error(process.env.HORU_ANKI_URL ? `Anki is not reachable at ${process.env.HORU_ANKI_URL} (is that computer on, with Anki and AnkiConnect running?).` : 'This Horu has no Anki: make the card on the phone (Settings → Cards on this phone).');
    }
    const launcher = ankiLauncher();
    if (!launcher) throw new Error('Anki is not running and was not found on this computer.');
    log.info('Starting Anki', launcher[0]);
    const child = spawn(launcher[0], launcher[1], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => undefined); // e.g. `anki` not on the PATH: the wait below reports it
    child.unref();
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await ankiOnline()) return;
    }
    throw new Error('Anki did not start within 60 s (is AnkiConnect installed?).');
  })().finally(() => (starting = undefined));
  return starting;
}

export function isAnkiStarting(): boolean {
  return starting !== undefined;
}



// ---- note type (shared/notetype.ts) ----

async function ensureModel(): Promise<void> {
  const models = await invoke<string[]>('modelNames');
  if (!models.includes(MODEL_NAME)) {
    await invoke('createModel', {
      modelName: MODEL_NAME,
      inOrderFields: FIELDS,
      css: CSS,
      isCloze: false,
      cardTemplates: [{ Name: 'Sentence', Front: FRONT, Back: BACK }],
    });
    log.info('Created Anki note type', MODEL_NAME);
    return;
  }
  // Keep templates in sync with this file so design tweaks reach existing cards.
  await invoke('updateModelTemplates', { model: { name: MODEL_NAME, templates: { Sentence: { Front: FRONT, Back: BACK } } } });
  await invoke('updateModelStyling', { model: { name: MODEL_NAME, css: CSS } });
}

/** Id of the Horu note type in the laptop's Anki, so .apkg files built on the phone land in the same type. */
export async function noteTypeId(): Promise<number | undefined> {
  if (!(await ankiOnline())) return undefined;
  const ids = await invoke<Record<string, number>>('modelNamesAndIds');
  return ids[MODEL_NAME];
}

type DeckConfig = { id: number; name: string; new: { perDay: number } };

async function ensureDeck(deck: string): Promise<void> {
  const decks = await invoke<string[]>('deckNames');
  if (decks.includes(deck)) return;
  await invoke('createDeck', { deck });
  const current = await invoke<DeckConfig>('getDeckConfig', { deck });
  let config = current;
  if (current.name !== 'Horu') {
    const id = await invoke<number>('cloneDeckConfigId', { name: 'Horu', cloneFrom: current.id });
    await invoke('setDeckConfigId', { decks: [deck], configId: id });
    config = await invoke<DeckConfig>('getDeckConfig', { deck });
  }
  config.new.perDay = getSettings().newCardsPerDay;
  await invoke('saveDeckConfig', { config });
  log.info(`Created deck "${deck}" with ${config.new.perDay} new cards/day`);
}

let prepared = false;
async function prepare(deck: string): Promise<void> {
  await ensureAnki();
  if (!prepared) {
    await ensureModel();
    prepared = true;
  }
  await ensureDeck(deck);
}

export type NoteInput = {
  sentence: string;
  sentenceFurigana: string;
  target: string;
  targetReading: string;
  targetMeaning: string;
  translation: string;
  explanation: string;
  context: string;
  audioPath?: string;
  imagePath?: string;
  source: string;
  mediaPrefix: string;
  tags: string[];
};

export async function addNote(input: NoteInput): Promise<number> {
  const deck = getSettings().deckName;
  await prepare(deck);
  let audio = '';
  let image = '';
  if (input.audioPath && fs.existsSync(input.audioPath)) {
    const filename = `${input.mediaPrefix}.mp3`;
    await invoke('storeMediaFile', { filename, path: input.audioPath });
    audio = `[sound:${filename}]`;
  }
  if (input.imagePath && fs.existsSync(input.imagePath)) {
    const filename = `${input.mediaPrefix}.jpg`;
    await invoke('storeMediaFile', { filename, path: input.imagePath });
    image = `<img src="${filename}">`;
  }
  const noteId = await invoke<number>('addNote', {
    note: {
      deckName: deck,
      modelName: MODEL_NAME,
      fields: {
        Sentence: input.sentence,
        SentenceFurigana: input.sentenceFurigana,
        Target: input.target,
        TargetReading: input.targetReading,
        TargetMeaning: input.targetMeaning,
        Translation: input.translation,
        Explanation: input.explanation,
        Context: input.context,
        Audio: audio,
        Image: image,
        Source: input.source,
      },
      options: { allowDuplicate: true },
      tags: ['horu', ...input.tags],
    },
  });
  scheduleSync();
  return noteId;
}

let syncTimer: NodeJS.Timeout | undefined;
/** Debounced AnkiWeb sync so a batch of cards triggers a single sync. */
function scheduleSync(): void {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    invoke('sync').then(
      () => log.info('AnkiWeb sync done'),
      (err) => log.warn('AnkiWeb sync failed', err),
    );
  }, 20_000);
}

/** Which of these words already are the target of a Horu note (one AnkiConnect round trip). */
export async function existingTargets(words: string[]): Promise<Set<string>> {
  if (!words.length) return new Set();
  const esc = (w: string) => w.replace(/["*_\\:]/g, '\\$&'); // Anki search syntax
  const results = await invoke<unknown[]>('multi', {
    actions: words.map((w) => ({ action: 'findNotes', params: { query: `"note:${MODEL_NAME}" "Target:${esc(w)}"` } })),
  });
  return new Set(words.filter((_, i) => Array.isArray(results[i]) && (results[i] as unknown[]).length > 0));
}

export type CardInfo = { cardId: number; note: number; modelName: string; deckName: string; interval: number; type: number; fields: Record<string, { value: string }> };

/** Card details for an Anki search (batched; used to estimate known vocabulary). */
export async function cardsFor(query: string): Promise<CardInfo[]> {
  await ensureAnki();
  const cardIds = await invoke<number[]>('findCards', { query });
  const out: CardInfo[] = [];
  for (let i = 0; i < cardIds.length; i += 500) {
    out.push(...(await invoke<CardInfo[]>('cardsInfo', { cards: cardIds.slice(i, i + 500) })));
  }
  return out;
}
