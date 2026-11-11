import { allKeys, recall, remember } from './mirror.ts';
import { mergeSkill, type SkillMap } from '../../../shared/kanjiSkill.ts';

// A file with everything that lives only on this phone: marks and sessions waiting for the laptop, texts,
// word status, kanji progress, cards waiting for an export, reader notes and preferences. Nothing secret goes
// in (no keys, no laptop token); big downloads that can be fetched again (dictionaries, manga pages, the audio
// of a text) stay out. Restoring merges into what the phone has: nothing is deleted.

const MAGIC = 'horu-phone-backup';

/** localStorage entries that are not the user's data: pairing, secrets, copies of downloads. */
const SKIP_LOCAL = /^(horu-laptop|horu-jimaku-key|horu-anilist$|horu-offline-chapters|horu-chapter-pages|horu-dict|horu-kuromoji|horu-manga|horu-pending|horu-flash)/;
/** IndexedDB entries that hold the user's own data (the rest is a copy of what the laptop said). */
const KEEP_STORE = /^(cues:|text:|times:)|^(texts|words-local|kanji-skill|kanji-seen|kanji-levels|card-queue)$/;
const MEDIA = 'horu-local-media';

export type Backup = {
  horu: typeof MAGIC;
  format: 1;
  app: string;
  at: string;
  local: Record<string, string>;
  store: Record<string, unknown>;
  media: { url: string; type: string; data: string }[];
};

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function buildBackup(): Promise<{ file: File; summary: string }> {
  const local: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith('horu-') || SKIP_LOCAL.test(k)) continue;
    let v = localStorage.getItem(k);
    if (v === null) continue;
    if (k === 'horu-cards') {
      // API keys stay on the phone they were typed on
      try {
        const { keys: _keys, ...rest } = JSON.parse(v) as Record<string, unknown>;
        v = JSON.stringify(rest);
      } catch {
        continue;
      }
    }
    local[k] = v;
  }

  const store: Record<string, unknown> = {};
  for (const k of await allKeys()) {
    if (!KEEP_STORE.test(k)) continue;
    const value = (await recall<unknown>(k))?.value;
    if (value === undefined) continue;
    // A text's recording is not part of the file: its lines stay, as a plain text
    store[k] = k === 'texts' && Array.isArray(value) ? value.map((t: { audio?: boolean; job?: string }) => ({ ...t, audio: undefined, job: undefined })) : value;
  }

  const media: Backup['media'] = [];
  if (typeof caches !== 'undefined') {
    const cache = await caches.open(MEDIA);
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      if (!res) continue;
      const blob = await res.blob();
      if (blob.size > 3_000_000) continue;
      media.push({ url: req.url, type: blob.type, data: await toDataUrl(blob) });
    }
  }

  const backup: Backup = { horu: MAGIC, format: 1, app: __APP_VERSION__, at: new Date().toISOString(), local, store, media };
  const moments = count(local['horu-local-moments']);
  const texts = count(JSON.stringify(store['texts'] ?? []));
  const words = Object.keys((store['words-local'] as { status?: object } | undefined)?.status ?? {}).length;
  const file = new File([JSON.stringify(backup)], `horu-phone-${backup.at.slice(0, 10)}.json`, { type: 'application/json' });
  return { file, summary: `${moments} marks, ${texts} texts, ${words} word statuses, ${media.length} recordings` };
}

function count(json?: string): number {
  try {
    const v = JSON.parse(json ?? '[]') as unknown;
    return Array.isArray(v) ? v.length : 0;
  } catch {
    return 0;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Both lists kept (an item with an id once, the file's version winning); objects key by key. */
export function mergeValue(have: unknown, file: unknown): unknown {
  if (Array.isArray(have) && Array.isArray(file)) {
    const out: unknown[] = [...file];
    const ids = new Set(file.map((x) => (isObject(x) && typeof x.id === 'string' ? x.id : JSON.stringify(x))));
    for (const x of have) if (!ids.has(isObject(x) && typeof x.id === 'string' ? x.id : JSON.stringify(x))) out.push(x);
    return out;
  }
  if (isObject(have) && isObject(file)) {
    const out: Record<string, unknown> = { ...have };
    for (const [k, v] of Object.entries(file)) out[k] = k in have ? mergeValue(have[k], v) : v;
    return out;
  }
  return file;
}

/** Puts a backup file into this phone. Returns what it brought. */
export async function restoreBackup(file: File): Promise<string> {
  let data: Backup;
  try {
    data = JSON.parse(await file.text()) as Backup;
  } catch {
    throw new Error('This is not a Horu backup (the file cannot be read).');
  }
  if (data?.horu !== MAGIC || !isObject(data.local) || !isObject(data.store)) throw new Error('This is not a Horu phone backup.');
  if (data.format > 1) throw new Error('This backup was made by a newer Horu. Update the app first.');

  for (const [k, raw] of Object.entries(data.local)) {
    if (!k.startsWith('horu-') || SKIP_LOCAL.test(k) || typeof raw !== 'string') continue;
    const have = localStorage.getItem(k);
    let value = raw;
    if (have !== null) {
      try {
        value = JSON.stringify(mergeValue(JSON.parse(have), JSON.parse(raw)));
      } catch {
        // plain text such as a theme name: the file's value
      }
    }
    try {
      localStorage.setItem(k, value);
    } catch {
      throw new Error('The phone has no room left to store it.');
    }
  }

  for (const [k, value] of Object.entries(data.store)) {
    if (!KEEP_STORE.test(k)) continue;
    const have = (await recall<unknown>(k))?.value;
    let next: unknown = value;
    if (have !== undefined) {
      if (k === 'kanji-skill') next = mergeSkill(have as SkillMap, value as SkillMap);
      else if (k === 'kanji-seen') next = [...new Set([...String(have), ...String(value)])].join('');
      else if (!k.startsWith('cues:') && !k.startsWith('text:') && !k.startsWith('times:')) next = mergeValue(have, value);
    }
    await remember(k, next);
  }

  if (typeof caches !== 'undefined' && Array.isArray(data.media)) {
    const cache = await caches.open(MEDIA);
    for (const m of data.media) {
      try {
        const name = /local-media\/[\w.-]+$/.exec(m.url)?.[0];
        if (!name) continue;
        await cache.put(new URL(name, location.href).href, await fetch(m.data));
      } catch {
        // one recording lost is not worth stopping for
      }
    }
  }

  const moments = count(data.local['horu-local-moments']);
  return `Restored from ${data.at.slice(0, 10)}: ${moments} marks, ${count(JSON.stringify(data.store['texts'] ?? []))} texts, ${Object.keys((data.store['words-local'] as { status?: object } | undefined)?.status ?? {}).length} word statuses.`;
}
