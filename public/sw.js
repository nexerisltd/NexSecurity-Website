// Deliberately minimal — and deliberately NOT caching anything. This
// site is a private, always-online, frequently-updated learning space
// (auth-gated, DB-backed, video player fixed and redeployed often) — a
// service worker that caches its own shell is exactly the kind of thing
// that leaves a browser stuck running yesterday's JS against today's
// API until someone thinks to hard-refresh or clear site data. The ONLY
// reason this file exists is that Chrome/Edge's "installable as an app"
// criteria requires an active service worker with a fetch handler, which
// is what makes the PWA install prompt on /learn/downloads available.
// Every request — including this file's own updates — is served
// straight from cache-control headers instead (see next.config.js),
// never from here.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      // Also sweeps away any cache this worker created in an earlier
      // version, before this file was simplified to not cache at all.
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', () => {
  // Deliberately does NOT call event.respondWith(). Chrome/Edge's
  // installability check only requires a registered fetch handler to
  // exist — it never requires that handler to actually respond.
  //
  // The previous version of this file called
  // `event.respondWith(fetch(event.request))`, thinking that was a safe
  // transparent passthrough. It was not: a fetch() issued FROM INSIDE a
  // service worker is subject to the page's `connect-src` CSP directive,
  // not whatever directive (img-src, script-src, frame-src) the request
  // would normally fall under. That silently broke the YouTube player
  // script, profile picture loads, and occasionally navigation itself —
  // exactly the "video won't play until I clear site data" bug. Not
  // calling respondWith() at all means the browser handles every request
  // completely natively, as if this service worker weren't intercepting
  // it — which is the actual correct behavior for a worker that exists
  // only to satisfy PWA installability, not to do anything with traffic.
});
