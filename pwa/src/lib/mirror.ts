// The phone's own copy of what the laptop last said (inbox, history, insights, settings …), so every screen
// still shows something when the laptop is off. Kept in IndexedDB; storage is asked to persist so iOS does
// not clear it.

const DB_NAME = 'horu';
const STORE = 'mirror';
let db: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return db;
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const store = (await open()).transaction(STORE, mode).objectStore(STORE);
  return new Promise((resolve, reject) => {
    const req = fn(store);
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export async function remember(key: string, value: unknown): Promise<void> {
  await run('readwrite', (s) => s.put({ value, at: Date.now() }, key)).catch(() => undefined);
}

export async function recall<T>(key: string): Promise<{ value: T; at: number } | undefined> {
  return run<{ value: T; at: number } | undefined>('readonly', (s) => s.get(key)).catch(() => undefined);
}

export async function forget(key: string): Promise<void> {
  await run('readwrite', (s) => s.delete(key)).catch(() => undefined);
}

/** Every key with its value (for the phone backup). */
export async function allKeys(): Promise<string[]> {
  return (await run<IDBValidKey[]>('readonly', (s) => s.getAllKeys()).catch(() => [])).map(String);
}

void navigator.storage?.persist?.().catch(() => false);

// ---- media of open inbox moments ----

const MEDIA = 'horu-media';

/** Keeps audio and screenshots of these moments on the phone and drops the rest. */
export async function mirrorMedia(urls: string[]): Promise<void> {
  if (typeof caches === 'undefined') return;
  const cache = await caches.open(MEDIA);
  const keep = new Set(urls.map((u) => new URL(u, location.href).href));
  for (const req of await cache.keys()) if (!keep.has(req.url)) await cache.delete(req);
  for (const url of urls) {
    if (await cache.match(url)) continue;
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch(() => undefined);
    if (res?.ok) await cache.put(url, res);
  }
}

/** Object URL of a mirrored file (or a phone mark's own recording), or undefined if the phone has no copy. */
export async function mirroredMedia(url: string): Promise<string | undefined> {
  if (typeof caches === 'undefined') return undefined;
  const hit = (await (await caches.open(MEDIA)).match(url)) ?? (await (await caches.open('horu-local-media')).match(url));
  return hit ? URL.createObjectURL(await hit.blob()) : undefined;
}
