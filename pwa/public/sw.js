// Horu service worker: offline app shell + offline tokenizer dictionary.
// The JMdict file and manga chapters are cached by the app itself (Cache Storage).
// The app lives under a path (GitHub Pages: /horu/) or at the root (served by the laptop), so every path is
// relative to the worker's scope.

const BASE = new URL(self.registration.scope).pathname;
const SHELL = 'horu-shell-v1';
const KUROMOJI = 'horu-kuromoji-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll([BASE, BASE + 'manifest.webmanifest', BASE + 'icon-192.png'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('horu-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

// A switched-off laptop behind Tailscale does not refuse the connection, it just never answers.
// So the network only gets a few seconds to start answering before the cached shell is used. The limit ends with
// the first answer: a slow line may take as long as it needs for the rest.
const NETWORK_WAIT = 3000;

async function networkFirst(request) {
  const cache = await caches.open(SHELL);
  const stop = new AbortController();
  const limit = setTimeout(() => stop.abort(), NETWORK_WAIT);
  try {
    const res = await fetch(request, { signal: stop.signal });
    clearTimeout(limit);
    if (res.ok) cache.put(request.mode === 'navigate' ? BASE : request, res.clone());
    return res;
  } catch {
    return (await cache.match(request.mode === 'navigate' ? BASE : request)) ?? Response.error();
  }
}

// Daily-goal reminder (sent by the laptop, see server/src/reminder.ts).
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // plain text payload
  }
  event.waitUntil(self.registration.showNotification(data.title || 'Horu', { body: data.body || '', icon: BASE + 'icon-192.png', tag: data.tag || 'horu-goal' }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => 'focus' in c);
      return open ? open.focus() : self.clients.openWindow(BASE);
    }),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  // Manga pages and covers, also from the laptop's own address: offline copies are written by the app
  // (Cache "horu-manga").
  if (url.pathname.startsWith('/api/manga/files/') || url.pathname.startsWith('/api/manga/thumb/')) {
    return event.respondWith(
      caches
        .open('horu-manga')
        .then((c) => c.match(event.request))
        .then((hit) => hit ?? fetch(event.request)),
    );
  }
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // live data, handled by the app
  if (url.pathname.startsWith(BASE + 'dict/kuromoji/')) return event.respondWith(cacheFirst(KUROMOJI, event.request));
  if (url.pathname.startsWith(BASE + 'dict/')) return; // jmdict and kanjidic: cached by the app with versioning
  if (url.pathname.startsWith(BASE + 'assets/')) return event.respondWith(cacheFirst(SHELL, event.request));
  event.respondWith(networkFirst(event.request));
});
