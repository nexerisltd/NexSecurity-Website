'use client';

import { useEffect, useRef, useState } from 'react';

export function VideoDownloadButton({
  videoId,
  fallbackUrl,
}: {
  videoId: string;
  /** The old admin-pasted static link, used only if dynamic resolution
   * downloads aren't configured (BUNNY_* env vars) or fail to load. */
  fallbackUrl?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [resolutions, setResolutions] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [issuing, setIssuing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Real error text from a failed resolutions-list call (CDN hiccup, auth
  // issue, etc). Kept separate from `failed` — only "feature genuinely not
  // configured" (503) or a total network failure falls back to the admin's
  // static link; everything else shows the real error + a Retry, since the
  // static fallback is usually just a raw .m3u8 URL that isn't a real
  // download either and only confuses students.
  const [listError, setListError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  async function loadResolutions() {
    if (resolutions !== null || failed) return; // already loaded (or already gave up)
    setListError(null);
    try {
      const res = await fetch(`/api/video/${videoId}/hls-download`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 503 && fallbackUrl) {
          setFailed(true); // not configured at all -> static fallback is the intended path
          return;
        }
        setListError(data?.error ?? `Could not load resolutions (${res.status}).`);
        return;
      }
      setResolutions(data?.resolutions ?? []);
    } catch {
      setListError('Could not reach the server. Check your connection and try again.');
    }
  }

  function openMenu() {
    setOpen((v) => !v);
    void loadResolutions();
  }

  function pick(resolution: string) {
    setIssuing(resolution);
    setError(null);
    // Same-origin, server-streamed file (built live from the HLS segments,
    // independent of Bunny's MP4-rendition download feature) — a plain
    // navigation lets the browser handle it as a native download with its
    // own progress UI, rather than buffering the whole video in JS memory.
    // New tab so a JSON error response (no attachment header) never
    // navigates the student away from the class page.
    const url = `/api/video/${videoId}/hls-download?resolution=${encodeURIComponent(resolution)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    setOpen(false);
    setIssuing(null);
  }

  // Dynamic resolutions never loaded / not configured / genuinely empty
  // → fall back to the plain static link if the admin set one.
  const showFallback = (failed || (resolutions !== null && resolutions.length === 0)) && fallbackUrl;
  if (showFallback) {
    return (
      <a
        href={fallbackUrl!}
        target="_blank"
        rel="noopener noreferrer"
        className="flex shrink-0 items-center gap-2 rounded-lg bg-signal px-4 py-2.5 text-sm font-medium text-white transition hover:bg-signal-glow"
      >
        <span aria-hidden>⬇</span>
        Download
      </a>
    );
  }

  if (failed && !fallbackUrl) return null;

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        onClick={openMenu}
        className="flex items-center gap-2 rounded-lg bg-signal px-4 py-2.5 text-sm font-medium text-white transition hover:bg-signal-glow"
      >
        <span aria-hidden>⬇</span>
        Download
        <span aria-hidden className={`transition ${open ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>

      {open && (
        <div className="glass-panel-solid absolute right-0 z-20 mt-2 w-52 overflow-hidden rounded-xl py-1">
          {listError ? (
            <div className="px-4 py-2.5">
              <p className="text-xs text-danger">{listError}</p>
              <button
                onClick={() => void loadResolutions()}
                className="mt-1 text-xs font-medium text-signal-glow hover:underline"
              >
                Retry
              </button>
            </div>
          ) : resolutions === null ? (
            <p className="px-4 py-2.5 text-xs text-ink-faint">Loading…</p>
          ) : resolutions.length === 0 ? (
            <p className="px-4 py-2.5 text-xs text-ink-faint">No downloads available.</p>
          ) : (
            resolutions.map((r) => (
              <button
                key={r}
                onClick={() => pick(r)}
                disabled={issuing !== null}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm text-ink transition hover:bg-vault-700 disabled:opacity-50"
              >
                {r}
                {issuing === r && <span className="text-xs text-ink-faint">…</span>}
              </button>
            ))
          )}
          {error && <p className="px-4 py-2 text-xs text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
