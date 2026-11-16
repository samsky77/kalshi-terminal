// KX Terminal service worker: offline app shell.
// Market data is NOT cached here: the app keeps its last copy in IndexedDB together with its age, so old
// prices can never be replayed as if they were fresh.
const VERSION = 'kxt-v2';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

// Cache the page and every script and stylesheet it references, so the very first visit already works offline.
async function precache() {
  const cache = await caches.open(VERSION);
  await cache.addAll(SHELL);
  try {
    const html = await (await fetch('/', { cache: 'no-store' })).text();
    const assets = [...new Set([...html.matchAll(/["'(](\/_next\/static\/[^"')\s\\]+)/g)].map((m) => m[1]))];
    await Promise.all(assets.map((u) => cache.add(u).catch(() => {})));
  } catch { /* offline during install: the shell alone is cached */ }
}

self.addEventListener('install', (e) => {
  e.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// Pages the app has open tell the worker which files they loaded (covers chunks loaded later, e.g. the sim worker).
self.addEventListener('message', (e) => {
  const urls = e.data && e.data.type === 'cache-assets' && Array.isArray(e.data.urls) ? e.data.urls : null;
  if (!urls) return;
  e.waitUntil(caches.open(VERSION).then((cache) => Promise.all(urls
    .filter((u) => typeof u === 'string' && new URL(u, self.location.origin).origin === self.location.origin && new URL(u, self.location.origin).pathname.startsWith('/_next/static/'))
    .map(async (u) => { if (!(await cache.match(u))) await cache.add(u).catch(() => {}); }))));
});

async function networkFirst(req, timeoutMs) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req, timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : undefined);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = (await cache.match(req, { ignoreSearch: req.mode === 'navigate' })) || (req.mode === 'navigate' ? await cache.match('/') : undefined);
    return hit || Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // POST /api/odds/refresh is never cached or replayed
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(cacheFirst(req));
  } else if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req, 4000)); // a hanging network falls back to the cached shell after 4 s
  } else if (url.pathname === '/manifest.webmanifest') {
    e.respondWith(networkFirst(req));
  }
});
