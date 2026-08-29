'use client';

import Script from 'next/script';
import { useCallback, useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    playerjs?: {
      Player: new (iframe: HTMLIFrameElement) => PlayerJsInstance;
    };
  }
}

type PlayerJsInstance = {
  on: (event: string, cb: (data?: unknown) => void) => void;
  play: () => void;
  pause: () => void;
  getCurrentTime: (cb: (seconds: number) => void) => void;
  setCurrentTime: (seconds: number) => void;
  getDuration: (cb: (seconds: number) => void) => void;
  // Not part of the documented player.js/Bunny spec — calling it is a
  // harmless no-op if unsupported, so it's used as a best-effort "try it,
  // don't rely on it" call. See the space-hold handler below.
  setPlaybackRate?: (rate: number) => void;
};

const SEEK_SECONDS = 10;
const HOLD_THRESHOLD_MS = 320;
const HEARTBEAT_MS = 4 * 60 * 1000; // well inside the ~10-minute token expiry

export function VideoPlayer({
  videoId,
  initialUrl,
  initialProvider,
}: {
  videoId: string;
  initialUrl?: string | null;
  initialProvider?: string | null;
}) {
  const [url, setUrl] = useState<string | null>(initialUrl ?? null);
  const [provider, setProvider] = useState<string | null>(initialProvider ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!initialUrl);
  const [revoked, setRevoked] = useState(false);
  const [playerJsReady, setPlayerJsReady] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const isBunny = provider === 'bunny';

  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const playerRef = useRef<PlayerJsInstance | null>(null);
  const isPlayingRef = useRef(false);
  const spaceDownRef = useRef(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdingFastRef = useRef(false);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPlaybackUrl = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`/api/video/${videoId}/play`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Playback unavailable.');
      if (data.provider) setProvider(data.provider);
      return true;
    } catch {
      return false;
    }
  }, [videoId]);

  // Initial load — skipped when the server already rendered the URL
  // (initialUrl prop, from app/learn/video/[id]/page.tsx): that's the same
  // authorization check, already done server-side, so re-fetching it
  // again immediately on mount would just be a redundant round trip. The
  // heartbeat below still re-verifies on its normal schedule either way.
  useEffect(() => {
    if (initialUrl) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRevoked(false);
    (async () => {
      try {
        const res = await fetch(`/api/video/${videoId}/play`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Playback unavailable.');
        if (!cancelled) {
          setUrl(data.url);
          setProvider(data.provider ?? null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Playback unavailable.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  // Heartbeat: re-checks authorization in the background while the tab
  // stays open, WITHOUT touching the already-loaded iframe on success (so
  // playback is never interrupted for a still-valid session). Only acts
  // on failure — e.g. an admin just revoked this device/IP, or disabled
  // the account — by stopping playback immediately instead of leaving an
  // already-open tab playing indefinitely until it's refreshed.
  useEffect(() => {
    if (!url) return;
    const interval = setInterval(async () => {
      const ok = await fetchPlaybackUrl();
      if (!ok) {
        setRevoked(true);
        setUrl(null);
      }
    }, HEARTBEAT_MS);
    return () => clearInterval(interval);
  }, [url, fetchPlaybackUrl]);

  // Wire up player.js once both the library and the iframe exist. Bunny
  // only — YouTube's iframe has no player.js support at all, it uses its
  // own (different) IFrame Player API, so it just gets its own native
  // controls below instead of these custom ones.
  useEffect(() => {
    if (!isBunny || !playerJsReady || !url || !iframeRef.current || !window.playerjs) return;
    const player = new window.playerjs.Player(iframeRef.current);
    playerRef.current = player;
    player.on('ready', () => {
      player.on('play', () => {
        isPlayingRef.current = true;
      });
      player.on('pause', () => {
        isPlayingRef.current = false;
      });
    });
    return () => {
      playerRef.current = null;
    };
  }, [playerJsReady, url]);

  function showHint(text: string) {
    setHint(text);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    hintTimerRef.current = setTimeout(() => setHint(null), 650);
  }

  function seek(deltaSeconds: number) {
    const player = playerRef.current;
    if (!player) return;
    player.getCurrentTime((current) => {
      player.setCurrentTime(Math.max(0, current + deltaSeconds));
    });
    showHint(deltaSeconds > 0 ? `+${deltaSeconds}s` : `${deltaSeconds}s`);
  }

  function toggleFullscreen() {
    // Deliberately NOT part of player.js — fullscreening the wrapping
    // element is a plain browser API and works regardless of what the
    // embedded (cross-origin) player itself supports.
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      el.requestFullscreen?.();
    }
  }

  // The Screen Orientation API's lock() only succeeds in a fullscreen
  // context in most browsers, so this runs off the fullscreenchange
  // event rather than inside toggleFullscreen() itself — requestFullscreen()
  // is async and the element isn't actually fullscreen yet the instant
  // toggleFullscreen() returns. Best-effort throughout: iOS Safari has no
  // Screen Orientation API at all, and unlock() during teardown can throw
  // if the document is already leaving fullscreen — neither should ever
  // surface as a visible error to someone just trying to watch a class.
  useEffect(() => {
    function onFullscreenChange() {
      const orientation = screen.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
      if (document.fullscreenElement) {
        orientation?.lock?.('landscape')?.catch(() => {});
      } else {
        try {
          orientation?.unlock?.();
        } catch {
          // ignore — see comment above
        }
      }
    }
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  function togglePlayPause() {
    const player = playerRef.current;
    if (!player) return;
    if (isPlayingRef.current) {
      player.pause();
      showHint('Paused');
    } else {
      player.play();
      showHint('Playing');
    }
  }

  useEffect(() => {
    function isTypingTarget(target: EventTarget | null) {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    }

    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target) || !playerRef.current) return;

      if (e.code === 'ArrowRight') {
        e.preventDefault();
        seek(SEEK_SECONDS);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        seek(-SEEK_SECONDS);
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.code === 'Space') {
        e.preventDefault();
        if (spaceDownRef.current) return; // ignore OS key-repeat
        spaceDownRef.current = true;
        holdTimerRef.current = setTimeout(() => {
          // Held past the threshold: switch to fast playback instead of
          // toggling play/pause. Best-effort — see PlayerJsInstance note.
          holdingFastRef.current = true;
          playerRef.current?.setPlaybackRate?.(2);
          showHint('2×');
        }, HOLD_THRESHOLD_MS);
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== 'Space') return;
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      spaceDownRef.current = false;

      if (holdingFastRef.current) {
        holdingFastRef.current = false;
        playerRef.current?.setPlaybackRate?.(1);
        showHint('1×');
      } else if (playerRef.current) {
        togglePlayPause();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={containerRef} className="group relative aspect-video w-full overflow-hidden rounded-xl border border-vault-border bg-vault-800">
      {isBunny && (
        <Script
          src="https://assets.mediadelivery.net/playerjs/playerjs-latest.min.js"
          strategy="afterInteractive"
          onLoad={() => setPlayerJsReady(true)}
        />
      )}

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-xs uppercase tracking-widest text-ink-faint">
            Verifying access…
          </span>
        </div>
      )}

      {revoked && !loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-vault-950/90 px-6 text-center backdrop-blur-sm">
          <span className="font-mono text-xs uppercase tracking-widest text-danger">
            Access revoked
          </span>
          <p className="max-w-xs text-xs text-ink-dim">
            This session is no longer authorized to play this class. Reload the page if you
            believe this is a mistake.
          </p>
        </div>
      )}

      {error && !loading && !revoked && (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
          <span className="font-mono text-xs uppercase tracking-widest text-danger">{error}</span>
        </div>
      )}

      {url && !loading && !error && !revoked && (
        // Bunny: a signed, ~10-minute embed token (see /api/video/[id]/play)
        // — fetched fresh per session, expires, and is restricted to
        // Bunny's configured "Allowed Referrers". YouTube: a permanent,
        // never-expiring video id — see the comment in
        // app/api/video/[id]/play/route.ts for why that's a real,
        // accepted trade-off for free hosting rather than an oversight.
        <iframe
          ref={iframeRef}
          src={url}
          loading="lazy"
          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; clipboard-write; web-share"
          allowFullScreen
          className="h-full w-full border-0"
        />
      )}

      {hint && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-vault-950/80 px-4 py-2 font-mono text-sm text-white shadow-glass backdrop-blur-sm">
          {hint}
        </div>
      )}

      {isBunny && url && !loading && !error && !revoked && (
        <div className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-vault-950/70 px-2.5 py-1 font-mono text-[9px] uppercase tracking-widest text-white/70 opacity-0 backdrop-blur-sm transition group-hover:opacity-100">
          ←/→ 10s · Space play/pause (hold 2×) · F fullscreen
        </div>
      )}
    </div>
  );
}
