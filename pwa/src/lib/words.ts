import { jlptWords, jpdbKnown, wanikaniKnown } from '../../../shared/knownSources.ts';
import { isUnderstood, parseWordList, type WordState, type WordStatus } from '../../../shared/words.ts';
import { infoOf, lookupDicts, parseYomitan, type DictHit, type DictInfo, type YomitanDict } from '../../../shared/yomitan.ts';
import { api, laptopUp, OfflineError } from './api.ts';
import { forget, recall, remember } from './mirror.ts';

// Known words and word status on the phone. The laptop's state (Anki, jpdb, WaniKani, lists, statuses) is
// copied whenever it is reachable; changes made on the phone apply at once and go to the laptop through the
// outbox. Without any laptop the phone keeps its own sources (word lists, WaniKani, JLPT baseline) and its
// own Yomitan dictionaries.

type Local = {
  /** Status set on this phone that the laptop may not have yet */
  status: Record<string, WordStatus>;
  /** Known-word sources imported on the phone itself */
  imported: Record<string, string[]>;
};

let state: WordState | undefined;
let local: Local | undefined;
let known: Set<string> | undefined;
let loadedAt = 0;

async function localState(): Promise<Local> {
  local ??= (await recall<Local>('words-local'))?.value ?? { status: {}, imported: {} };
  return local;
}

async function saveLocal(): Promise<void> {
  if (local) await remember('words-local', local);
  known = undefined;
  dispatchEvent(new Event('horu-words'));
}

let loading: Promise<void> | undefined;
/** Fresh copy from the laptop at most every 5 minutes; the saved one otherwise. One at a time. */
function load(): Promise<void> {
  loading ??= refresh().finally(() => (loading = undefined));
  return loading;
}

async function refresh(): Promise<void> {
  const l = await localState();
  if (!state || (laptopUp() && Date.now() - loadedAt > 5 * 60_000)) {
    loadedAt = Date.now();
    state = await api.words().catch(() => state ?? undefined);
    // Phone changes the laptop already has can go; the others are sent (e.g. made before the laptop was connected).
    if (state && laptopUp())
      for (const [w, s] of Object.entries(l.status)) {
        if (state.status[w] === s) delete l.status[w];
        else void api.setStatus(w, s).catch(() => undefined);
      }
    known = undefined;
  }
  // A phone that never met a laptop starts from the JLPT N5/N4 list.
  if (!state && !l.imported.jlpt) {
    const words = await jlptWords().catch(() => []);
    if (words.length) {
      l.imported.jlpt = words;
      await saveLocal();
    }
  }
}

async function knownSet(): Promise<Set<string>> {
  await load();
  if (known) return known;
  const l = await localState();
  const set = new Set<string>([...(state?.known ?? []), ...Object.values(l.imported).flat()]);
  for (const [w, s] of Object.entries({ ...state?.status, ...l.status })) {
    if (isUnderstood(s)) set.add(w);
    else set.delete(w);
  }
  known = set;
  return set;
}

/** Status of each word: set by hand, else 4 if a source knows it, else undefined (new). */
export async function statusOf(words: string[]): Promise<Record<string, WordStatus | undefined>> {
  const set = await knownSet();
  const l = await localState();
  return Object.fromEntries(words.map((w) => [w, l.status[w] ?? state?.status[w] ?? (set.has(w) ? 4 : undefined)]));
}

export async function knownCheck(words: string[]): Promise<Record<string, boolean>> {
  const set = await knownSet();
  return Object.fromEntries(words.map((w) => [w, set.has(w)]));
}

/** Words this phone alone knows for real: imports other than the JLPT starter list, and words set to Known. */
export async function ownKnownWords(): Promise<string[]> {
  const l = await localState();
  const set = new Set(Object.entries(l.imported).filter(([source]) => source !== 'jlpt').flatMap(([, words]) => words));
  for (const [w, s] of Object.entries(l.status)) {
    if (isUnderstood(s)) set.add(w);
    else set.delete(w);
  }
  return [...set];
}

export async function setWordStatus(word: string, status: WordStatus): Promise<void> {
  const l = await localState();
  l.status[word] = status;
  await saveLocal();
  await api.setStatus(word, status).catch(() => undefined);
}

/** A card was made on the phone: the word counts as known unless it already has a status. */
export async function cardMadeFor(word: string): Promise<void> {
  const current = (await statusOf([word]))[word];
  if (current === undefined) await setWordStatus(word, 4);
}

export type KnownSource = 'wanikani' | 'jpdb' | 'list';

/** Imports known words; on the laptop when it is reachable (it then keeps them up to date), else on the phone. */
export async function importKnown(source: KnownSource, input: string): Promise<{ count: number; where: 'laptop' | 'phone' }> {
  if (laptopUp()) {
    try {
      const { count } = await api.importKnown(source, input);
      loadedAt = 0;
      known = undefined;
      return { count, where: 'laptop' };
    } catch (e) {
      if (!(e instanceof OfflineError)) throw e;
    }
  }
  let words: string[];
  if (source === 'list') words = parseWordList(input);
  else if (source === 'wanikani') words = await wanikaniKnown(input);
  else {
    words = await jpdbKnown(input).catch((e: Error) => {
      throw new Error(/fetch|network|load/i.test(e.message) ? 'jpdb does not answer this phone directly. Import it once with the laptop on.' : e.message);
    });
  }
  if (!words.length) throw new Error('No Japanese words found');
  const l = await localState();
  l.imported[source] = words;
  await saveLocal();
  return { count: words.length, where: 'phone' };
}

export async function knownSummary(): Promise<{ total: number; phone: Record<string, number>; statuses: number }> {
  const set = await knownSet();
  const l = await localState();
  return {
    total: set.size,
    phone: Object.fromEntries(Object.entries(l.imported).map(([k, v]) => [k, v.length])),
    statuses: Object.keys({ ...state?.status, ...l.status }).length,
  };
}

// ---- Yomitan dictionaries ----

let dicts: YomitanDict[] | undefined;

export async function phoneDicts(): Promise<DictInfo[]> {
  return (await recall<DictInfo[]>('yomitan:list'))?.value ?? [];
}

async function loadDicts(): Promise<YomitanDict[]> {
  if (dicts) return dicts;
  const list = await phoneDicts();
  dicts = (await Promise.all(list.map((d) => recall<YomitanDict>(`yomitan:${d.id}`)))).flatMap((r) => (r ? [r.value] : []));
  return dicts;
}

/** Imports a Yomitan zip: onto the laptop when reachable, otherwise into this phone. */
export async function importDictionary(file: File): Promise<{ info: DictInfo; where: 'laptop' | 'phone' }> {
  if (laptopUp()) {
    try {
      return { info: await api.importDict(file), where: 'laptop' };
    } catch (e) {
      if (!(e instanceof OfflineError)) throw e;
    }
  }
  const dict = parseYomitan(new Uint8Array(await file.arrayBuffer()));
  await remember(`yomitan:${dict.id}`, dict);
  await remember('yomitan:list', [...(await phoneDicts()).filter((d) => d.id !== dict.id), infoOf(dict)]);
  dicts = undefined;
  return { info: infoOf(dict), where: 'phone' };
}

export async function removePhoneDict(id: string): Promise<void> {
  await forget(`yomitan:${id}`);
  await remember('yomitan:list', (await phoneDicts()).filter((d) => d.id !== id));
  dicts = undefined;
}

/** Extra dictionary results (definitions, frequency, pitch accent): laptop first, then the phone's own. */
export async function dictExtras(forms: string[]): Promise<Record<string, DictHit>> {
  const own = await loadDicts();
  const fromLaptop = laptopUp() ? await api.dictLookup(forms).catch(() => ({}) as Record<string, DictHit>) : {};
  if (!own.length) return fromLaptop;
  const mine = lookupDicts(own, forms);
  const out: Record<string, DictHit> = { ...mine };
  for (const [form, hit] of Object.entries(fromLaptop)) {
    const m = mine[form];
    out[form] = m ? { defs: [...hit.defs, ...m.defs], freq: hit.freq ?? m.freq, pitch: hit.pitch ?? m.pitch } : hit;
  }
  return out;
}
