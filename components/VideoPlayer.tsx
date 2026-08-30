'use client';

import Script from 'next/script';
import { useCallback, useEffect, useRef, useState } from 'react';
import { extractYoutubeId } from '@/lib/youtube';

declare global {
  interface Window {
    playerjs?: {
      Player: new (iframe: HTMLIFrameElement) => PlayerJsInstance;
    };
    // YouTube's IFrame Player API — loaded from https://www.youtube.com/iframe_api,
    // which calls this global once it's ready. Types kept minimal (only
    // what's actually used below); see
    // https://developers.google.com/youtube/iframe_api_reference.
    YT?: {
      Player: new (el: HTMLElement, options: YtPlayerOptions) => YtPlayerInstance;
      PlayerState: { PLAYING: number; PAUSED: number; ENDED: number; BUFFERING: number };
    };
    onYouTubeIframeAPIReady?: () => void;
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

type YtPlayerOptions = {
  videoId: string;
  host?: string;
  playerVars?: Record<string, number | string>;
  events?: {
    onReady?: (e: { target: YtPlayerInstance }) => void;
    onStateChange?: (e: { data: number; target: YtPlayerInstance }) => void;
  };
};

type YtPlayerInstance = {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  mute: () => void;
  unMute: () => void;
  isMuted: () => boolean;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  setPlaybackRate: (rate: number) => void;
  destroy: () => void;
};

const SEEK_SECONDS = 10;
const HOLD_THRESHOLD_MS = 320;
const HEARTBEAT_MS = 4 * 60 * 1000; // well inside the ~10-minute token expiry
const YT_TIME_POLL_MS = 400; // YT's API has no timeupdate event, only polling

function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

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
  const isYoutube = provider === 'youtube';

  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const playerRef = useRef<PlayerJsInstance | null>(null);
  const isPlayingRef = useRef(false);
  const spaceDownRef = useRef(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdingFastRef = useRef(false);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- YouTube (IFrame Player API) state ---
  const [ytApiReady, setYtApiReady] = useState(false);
  const [ytPlaying, setYtPlaying] = useState(false);
  const [ytBuffering, setYtBuffering] = useState(true);
  const [ytMuted, setYtMuted] = useState(false);
  const [ytCurrentTime, setYtCurrentTime] = useState(0);
  const [ytDuration, setYtDuration] = useState(0);
  const ytMountRef = useRef<HTMLDivElement>(null);
  const ytPlayerRef = useRef<YtPlayerInstance | null>(null);
  const ytSeekingRef = useRef(false);

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
        ytPlayerRef.current?.destroy();
        ytPlayerRef.current = null;
      }
    }, HEARTBEAT_MS);
    return () => clearInterval(interval);
  }, [url, fetchPlaybackUrl]);

  // Wire up player.js once both the library and the iframe exist. Bunny
  // only — YouTube gets its own IFrame Player API setup below instead.
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
  }, [isBunny, playerJsReady, url]);

  // --- YouTube: load the IFrame Player API script once, globally ---
  useEffect(() => {
    if (!isYoutube) return;
    if (window.YT?.Player) {
      setYtApiReady(true);
      return;
    }
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      setYtApiReady(true);
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(script);
    }
  }, [isYoutube]);

  // --- YouTube: create the player once the API and a video id are both
  // ready. controls=0 hides EVERY piece of YouTube's own UI — the title
  // bar, the share/link icon, the "Watch on YouTube" logo, all of it —
  // replaced entirely by the custom control bar rendered below. This is
  // the policy-compliant way to do that: YouTube's own IFrame API
  // explicitly supports building a fully custom player this way. Simply
  // overlaying invisible elements on top of YouTube's default UI to
  // selectively block just the branding/link pieces, while leaving the
  // rest of YouTube's native controls in place, is NOT compliant — see
  // "Required Minimum Functionality": blocking a link that would
  // normally appear in the YouTube player is explicitly called out as
  // prohibited. Building a complete replacement UI via the sanctioned
  // API, as done here, is the difference.
  useEffect(() => {
    if (!isYoutube || !ytApiReady || !url || !ytMountRef.current || !window.YT) return;
    const videoGuid = extractYoutubeId(url);
    if (!videoGuid) return;

    setYtBuffering(true);
    const player = new window.YT.Player(ytMountRef.current, {
      videoId: videoGuid,
      host: 'https://www.youtube-nocookie.com',
      playerVars: {
        controls: 0,
        rel: 0,
        iv_load_policy: 3,
        playsinline: 1,
        fs: 0, // fullscreen handled by our own button (toggleFullscreen)
        disablekb: 1, // keyboard handled by our own onKeyDown below
        modestbranding: 1,
        origin: window.location.origin,
      },
      events: {
        onReady: (e) => {
          ytPlayerRef.current = e.target;
          setYtDuration(e.target.getDuration());
          setYtMuted(e.target.isMuted());
          setYtBuffering(false);
        },
        onStateChange: (e) => {
          setYtPlaying(e.data === window.YT?.PlayerState.PLAYING);
          setYtBuffering(e.data === window.YT?.PlayerState.BUFFERING);
          if (e.data === window.YT?.PlayerState.PLAYING) {
            setYtDuration(e.target.getDuration());
          }
        },
      },
    });

    return () => {
      player.destroy?.();
      ytPlayerRef.current = null;
    };
  }, [isYoutube, ytApiReady, url]);

  // --- YouTube: poll current time while playing to drive the seek bar.
  // There's no push-based "timeupdate" event in this API — polling is
  // the documented way to track progress.
  useEffect(() => {
    if (!isYoutube || !ytPlaying) return;
    const interval = setInterval(() => {
      if (ytSeekingRef.current) return; // don't fight an in-progress drag
      const yp = ytPlayerRef.current;
      if (!yp) return;
      setYtCurrentTime(yp.getCurrentTime());
    }, YT_TIME_POLL_MS);
    return () => clearInterval(interval);
  }, [isYoutube, ytPlaying]);

  function showHint(text: string) {
    setHint(text);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    hintTimerRef.current = setTimeout(() => setHint(null), 650);
  }

  function seek(deltaSeconds: number) {
    if (isYoutube) {
      const yp = ytPlayerRef.current;
      if (!yp) return;
      const next = Math.max(0, yp.getCurrentTime() + deltaSeconds);
      yp.seekTo(next, true);
      setYtCurrentTime(next);
    } else {
      const player = playerRef.current;
      if (!player) return;
      player.getCurrentTime((current) => {
        player.setCurrentTime(Math.max(0, current + deltaSeconds));
      });
    }
    showHint(deltaSeconds > 0 ? `+${deltaSeconds}s` : `${deltaSeconds}s`);
  }

  function toggleFullscreen() {
    // Deliberately NOT part of either player SDK — fullscreening the
    // wrapping element is a plain browser API and works regardless of
    // what's embedded inside it.
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
    if (isYoutube) {
      const yp = ytPlayerRef.current;
      if (!yp) return;
      if (yp.getPlayerState() === window.YT?.PlayerState.PLAYING) {
        yp.pauseVideo();
        showHint('Paused');
      } else {
        yp.playVideo();
        showHint('Playing');
      }
      return;
    }
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

  function toggleMute() {
    const yp = ytPlayerRef.current;
    if (!yp) return;
    if (yp.isMuted()) {
      yp.unMute();
      setYtMuted(false);
    } else {
      yp.mute();
      setYtMuted(true);
    }
  }

  function onSeekBarChange(value: number) {
    ytSeekingRef.current = true;
    setYtCurrentTime(value);
  }

  function commitSeekBar(value: number) {
    ytPlayerRef.current?.seekTo(value, true);
    setYtCurrentTime(value);
    // Small delay before resuming the poll-driven sync, so the just-set
    // value doesn't get immediately overwritten by a still-in-flight
    // getCurrentTime() call from before the seek actually landed.
    setTimeout(() => {
      ytSeekingRef.current = false;
    }, 300);
  }

  useEffect(() => {
    function isTypingTarget(target: EventTarget | null) {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    }

    function setRate(rate: number) {
      if (isYoutube) ytPlayerRef.current?.setPlaybackRate(rate);
      else playerRef.current?.setPlaybackRate?.(rate);
    }

    function onKeyDown(e: KeyboardEvent) {
      const hasPlayer = isYoutube ? !!ytPlayerRef.current : !!playerRef.current;
      if (isTypingTarget(e.target) || !hasPlayer) return;

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
          // toggling play/pause.
          holdingFastRef.current = true;
          setRate(2);
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
        setRate(1);
        showHint('1×');
      } else {
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
  }, [isYoutube]);

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

      {isBunny && url && !loading && !error && !revoked && (
        // A signed, ~10-minute embed token (see /api/video/[id]/play) —
        // fetched fresh per session, expires, and is restricted to
        // Bunny's configured "Allowed Referrers".
        <iframe
          ref={iframeRef}
          src={url}
          loading="lazy"
          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; clipboard-write; web-share"
          allowFullScreen
          className="h-full w-full border-0"
        />
      )}

      {isYoutube && url && !loading && !error && !revoked && (
        <>
          {/* YT.Player takes this div over and injects its own iframe —
              no other React children ever go inside it. */}
          <div className="absolute inset-0" onClick={togglePlayPause}>
            <div ref={ytMountRef} className="pointer-events-none h-full w-full" />
          </div>

          {ytBuffering && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-vault-950/30">
              <span className="font-mono text-xs uppercase tracking-widest text-white/80">
                Loading…
              </span>
            </div>
          )}

          {!ytPlaying && !ytBuffering && (
            <button
              onClick={togglePlayPause}
              aria-label="Play"
              className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-vault-950 shadow-glass transition hover:scale-105"
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5.5v13l11-6.5-11-6.5Z" />
              </svg>
            </button>
          )}

          {/* Custom control bar — replaces YouTube's native one entirely
              (controls=0 above). Always visible rather than hover-only,
              since this needs to work on touch devices with no hover
              state at all. */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-vault-950/90 to-transparent px-3 pb-2 pt-6"
          >
            <button onClick={togglePlayPause} aria-label={ytPlaying ? 'Pause' : 'Play'} className="text-white">
              {ytPlaying ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5.5v13l11-6.5-11-6.5Z" />
                </svg>
              )}
            </button>

            <span className="font-mono text-[10px] text-white/80">{formatTime(ytCurrentTime)}</span>

            <input
              type="range"
              min={0}
              max={ytDuration || 0}
              step={0.1}
              value={ytCurrentTime}
              onChange={(e) => onSeekBarChange(Number(e.target.value))}
              onMouseDown={() => (ytSeekingRef.current = true)}
              onTouchStart={() => (ytSeekingRef.current = true)}
              onMouseUp={(e) => commitSeekBar(Number((e.target as HTMLInputElement).value))}
              onTouchEnd={(e) => commitSeekBar(Number((e.target as HTMLInputElement).value))}
              className="h-1 flex-1 cursor-pointer accent-signal"
              aria-label="Seek"
            />

            <span className="font-mono text-[10px] text-white/80">{formatTime(ytDuration)}</span>

            <button onClick={toggleMute} aria-label={ytMuted ? 'Unmute' : 'Mute'} className="text-white">
              {ytMuted ? (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                  <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
                  <path d="m16 9 4 6M20 9l-4 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                  <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
                  <path
                    d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </button>

            <button onClick={toggleFullscreen} aria-label="Fullscreen" className="text-white">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M9 4H5a1 1 0 0 0-1 1v4M15 4h4a1 1 0 0 1 1 1v4M9 20H5a1 1 0 0 1-1-1v-4M15 20h4a1 1 0 0 0 1-1v-4"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </>
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
