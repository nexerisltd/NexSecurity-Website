'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

type Popup = {
  title: string;
  message: string;
  button_label: string;
  button_url: string | null;
};

/**
 * Mounted once in app/layout.tsx so it runs on every page. Skips
 * /admin (an announcement meant for learners shouldn't interrupt an
 * admin mid-task) and /login (nobody's authorized yet there). The actual
 * "is this user due for it" decision is entirely server-side (see
 * app/api/popup/route.ts) — this component just asks on mount and
 * renders whatever comes back.
 */
export function SitePopup() {
  const pathname = usePathname();
  const [popup, setPopup] = useState<Popup | null>(null);
  const skip = pathname?.startsWith('/admin') || pathname === '/login';

  useEffect(() => {
    if (skip) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/popup');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data.popup) return;
        setPopup(data.popup);
        // Marked as seen as soon as it's actually shown, not only on an
        // explicit dismiss click — otherwise closing the tab without
        // clicking anything would show it again on every visit within
        // the interval instead of just once.
        fetch('/api/popup', { method: 'POST' }).catch(() => {});
      } catch {
        // Silently do nothing — an announcement popup is never worth
        // surfacing an error over.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skip]);

  if (!popup) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/60 px-4 py-8 backdrop-blur-sm sm:items-center">
      {/* flex-col + a fixed footer means the button row is ALWAYS visible
          and reachable — only the message text itself scrolls internally
          when it's too long for the viewport, instead of the whole card
          (buttons included) overflowing off-screen with no way to reach
          them. */}
      <div className="flex max-h-[85vh] w-full max-w-5xl flex-col rounded-2xl border border-vault-border bg-vault-900 shadow-glass">
        <div className="overflow-y-auto p-6">
          {popup.title && <h2 className="font-display text-lg font-semibold text-ink">{popup.title}</h2>}
          {popup.message && <p className="mt-2 whitespace-pre-line text-sm text-ink-dim">{popup.message}</p>}
        </div>
        <div className="flex flex-wrap justify-end gap-3 border-t border-vault-border p-4">
          {popup.button_url && (
            <a
              href={popup.button_url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-vault-border px-4 py-2 text-sm text-ink-dim transition hover:border-signal hover:text-ink"
            >
              Learn more
            </a>
          )}
          <button
            onClick={() => setPopup(null)}
            className="rounded-md bg-signal px-4 py-2 text-sm font-medium text-white transition hover:bg-signal-glow"
          >
            {popup.button_label || 'Got it'}
          </button>
        </div>
      </div>
    </div>
  );
}
