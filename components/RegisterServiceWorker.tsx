'use client';

import { useEffect } from 'react';

// Registered site-wide (root layout, not just the Downloads page) because
// PWA installability is a property of the whole origin — the browser
// decides whether to allow the install prompt based on whether a service
// worker is active for the scope, not on which page happens to be open
// when the person visits /learn/downloads. See public/sw.js for why it's
// otherwise a no-op pass-through.
export function RegisterServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        // Explicitly ask on every load, not just on whatever cadence the
        // browser's own heuristic uses — this is what lets anyone already
        // stuck on an old cached build recover the moment they reopen the
        // app, instead of only on some navigations.
        registration.update().catch(() => {});
      })
      .catch(() => {
        // Best-effort: a failed registration just means no install prompt
        // later — never something to surface to the user.
      });
  }, []);

  return null;
}
