// Block to Globe service worker. Plain JS, relative paths only.
// Shell files: cache-first (precached). data/*.json: network-first, cache fallback.
// Cross-origin requests (e.g. the Wikipedia fallback) are never touched or cached.
const CACHE = 'btg-v1';
const SHELL = [
  './',
  'index.html',
  'assets/style.css',
  'assets/app.js',
  'manifest.webmanifest',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/icon-maskable-512.png',
  'assets/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never cache cross-origin

  const scope = new URL('./', self.location).pathname;
  const path = url.pathname.slice(scope.length);

  if (path.startsWith('data/') && path.endsWith('.json')) {
    event.respondWith(networkFirst(req));
    return;
  }
  if (req.mode === 'navigate' || path === '' || SHELL.includes(path)) {
    event.respondWith(shellFirst(req));
  }
});

// Data: always try the network (bypassing the HTTP cache); keep the last good copy for offline.
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req, { cache: 'no-store' });
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}

// Shell: serve the cached copy at once, refresh it in the background so the next load is current.
async function shellFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  const refresh = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  });
  if (hit) { refresh.catch(() => {}); return hit; }
  try { return await refresh; }
  catch (err) { return (await cache.match('index.html')) || Response.error(); }
}
