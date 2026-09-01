// Deliberately minimal. This site is a private, always-online learning
// space (auth-gated, DB-backed) — it has no business trying to serve
// class content or video playback from a cache while offline, and doing
// so would risk showing stale/wrong data. The ONLY reason this file
// exists is that Chrome/Edge's "installable as an app" criteria requires
// an active service worker with a fetch handler, which is what makes the
// PWA install prompt on /learn/downloads actually available. Everything
// just passes straight through to the network.
const CACHE_NAME = 'nexsecurity-shell-v1';
// A handful of static, public, never-changing assets — enough to satisfy
// installability and let the icon/name show up correctly even the very
// first time this fires, without caching anything that could go stale.
const SHELL_ASSETS = ['/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .catch(() => {}) // best-effort — a failed precache must never block install
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for literally everything, including the shell assets —
// this only ever falls back to the cached copy if the network request
// itself fails outright (offline), never to serve stale content over a
// working connection.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request).then((cached) => cached ?? Response.error()))
  );
});
