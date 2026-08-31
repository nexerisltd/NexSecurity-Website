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
  getPlaybackRate: () => number;
  getAvailablePlaybackRates: () => number[];
  // Quality controls: YouTube largely auto-manages quality server-side now
  // and may ignore setPlaybackQuality, but the API is still there and this
  // keeps the menu functional wherever it is honored.
  getAvailableQualityLevels: () => string[];
  getPlaybackQuality: () => string;
  setPlaybackQuality: (level: string) => void;
  getVolume: () => number;
  setVolume: (volume: number) => void;
  getVideoLoadedFraction: () => number;
  destroy: () => void;
};

const QUALITY_LABELS: Record<string, string> = {
  auto: 'Auto',
  highres: 'Highres',
  hd2160: '2160p 4K',
  hd1440: '1440p',
  hd1080: '1080p',
  hd720: '720p',
  large: '480p',
  medium: '360p',
  small: '240p',
  tiny: '144p',
};

// YouTube's IFrame API officially deprecated manual quality control:
// getPlaybackQuality, setPlaybackQuality, and getAvailableQualityLevels are
// documented as "no longer supported" — setPlaybackQuality is now a no-op
// with zero effect on playback, for every embed everywhere, not just this
// one. See https://developers.google.com/youtube/iframe_api_reference
// ("Deprecations and changes"). There is no client-side fix for that; it's
// a platform restriction, not a bug in this player. The quality submenu
// below reflects the real, live-polled resolution instead of pretending a
// manual picker works.

const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const SEEK_SECONDS = 10;
const HOLD_THRESHOLD_MS = 320;
const HEARTBEAT_MS = 4 * 60 * 1000; // well inside the ~10-minute token expiry
const YT_TIME_POLL_MS = 400; // YT's API has no timeupdate event, only polling
const PROGRESS_SAVE_MS = 15 * 1000; // "resume playback" checkpoint cadence

// Shared per-button styling for the custom control bar — a small hit-area
// with a hover highlight, matching the reference bar's button treatment
// instead of bare unstyled icons.
const CTRL_BTN_CLASS =
  'flex items-center justify-center rounded-lg p-1.5 text-white/90 transition hover:bg-white/10 hover:text-white';

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
  initialResumeSeconds,
}: {
  videoId: string;
  initialUrl?: string | null;
  initialProvider?: string | null;
  initialResumeSeconds?: number | null;
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

  // --- "Resume playback": last watched position for this (user, video),
  // read either from the server-rendered page (initialResumeSeconds) or
  // from this component's own client-side /play fetch below. Applied
  // (seeked to) exactly once per mount via resumeAppliedRef — after
  // that, normal playback/seeking takes over and this is never consulted
  // again until the page is reloaded. Refs (not just the ytCurrentTime /
  // Bunny timeupdate state) track the live position so an unload/tab-close
  // flush always has an up-to-date value to send without waiting on an
  // async getCurrentTime callback.
  const [resumeSeconds, setResumeSeconds] = useState<number | null>(initialResumeSeconds ?? null);
  const resumeAppliedRef = useRef(false);
  const ytCurrentTimeRef = useRef(0);
  const ytDurationRef = useRef(0);
  const bunnyPositionRef = useRef(0);
  const bunnyDurationRef = useRef(0);

  // --- YouTube (IFrame Player API) state ---
  const [ytApiReady, setYtApiReady] = useState(false);
  const [ytPlaying, setYtPlaying] = useState(false);
  const [ytBuffering, setYtBuffering] = useState(true);
  const [ytMuted, setYtMuted] = useState(false);
  const [ytVolume, setYtVolume] = useState(1);
  const [ytCurrentTime, setYtCurrentTime] = useState(0);
  const [ytDuration, setYtDuration] = useState(0);
  const [ytBufferedFraction, setYtBufferedFraction] = useState(0);
  const ytMountRef = useRef<HTMLDivElement>(null);
  const ytPlayerRef = useRef<YtPlayerInstance | null>(null);
  const ytSeekingRef = useRef(false);

  // --- Settings menu (gear icon): Speed + Quality submenus ---
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPanel, setSettingsPanel] = useState<'main' | 'speed' | 'quality'>('main');
  const [speed, setSpeedState] = useState(1);
  const [quality, setQualityState] = useState('auto');
  const [qualityLevels, setQualityLevels] = useState<string[]>([]);
  const settingsRef = useRef<HTMLDivElement>(null);

  // Reports the current watch position to /api/video/[id]/progress —
  // fire-and-forget, best-effort (a failed save just means next load
  // starts from the previous checkpoint instead of the latest one, never
  // blocks or interrupts playback). Uses sendBeacon when available (works
  // even during page unload/tab close, unlike a normal fetch), falling
  // back to a keepalive fetch otherwise.
  const reportProgress = useCallback(
    (position: number, duration?: number) => {
      if (!Number.isFinite(position) || position < 0) return;
      const payload: { position_seconds: number; duration_seconds?: number } = {
        position_seconds: Math.floor(position),
      };
      if (Number.isFinite(duration) && (duration ?? 0) > 0) {
        payload.duration_seconds = Math.floor(duration as number);
      }
      const body = JSON.stringify(payload);
      try {
        if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
          navigator.sendBeacon(`/api/video/${videoId}/progress`, new Blob([body], { type: 'application/json' }));
        } else {
          fetch(`/api/video/${videoId}/progress`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            keepalive: true,
          }).catch(() => {});
        }
      } catch {
        // best-effort — a dropped progress report is never worth surfacing
      }
    },
    [videoId]
  );

  // Flush whichever provider is currently active on tab close/hide —
  // covers the common case of a student just closing the tab mid-class
  // without ever hitting pause. Also flushed on unmount for in-app (SPA)
  // navigation away from the page, which never fires beforeunload/pagehide.
  useEffect(() => {
    function flush() {
      if (isYoutube && ytPlayerRef.current) {
        reportProgress(ytCurrentTimeRef.current, ytDurationRef.current);
      } else if (isBunny && playerRef.current) {
        reportProgress(bunnyPositionRef.current, bunnyDurationRef.current);
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [isYoutube, isBunny, reportProgress]);

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
          if (typeof data.resumeSeconds === 'number') setResumeSeconds(data.resumeSeconds);
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
        // Save the moment playback pauses — the most common natural
        // checkpoint (student steps away, switches tabs, etc).
        reportProgress(bunnyPositionRef.current, bunnyDurationRef.current);
      });
      // player.js's Bunny implementation fires this continuously during
      // playback with { seconds, duration } — used both to keep the refs
      // above current (for the unload flush) and to drive the periodic
      // save interval below, without polling getCurrentTime ourselves.
      player.on('timeupdate', (data: unknown) => {
        const d = data as { seconds?: number; duration?: number } | undefined;
        if (typeof d?.seconds === 'number') bunnyPositionRef.current = d.seconds;
        if (typeof d?.duration === 'number' && d.duration > 0) bunnyDurationRef.current = d.duration;
      });
      // Resume playback — apply the saved position exactly once, and
      // only if it's not trivially close to the start or the very end
      // (near-end resume would just replay the last few seconds, which
      // reads as broken rather than helpful).
      if (!resumeAppliedRef.current && resumeSeconds && resumeSeconds > 5) {
        resumeAppliedRef.current = true;
        player.getDuration((duration) => {
          if (!duration || duration - resumeSeconds > 10) {
            player.setCurrentTime(resumeSeconds);
            bunnyPositionRef.current = resumeSeconds;
          }
        });
      }
    });
    return () => {
      playerRef.current = null;
    };
  }, [isBunny, playerJsReady, url, resumeSeconds, reportProgress]);

  // Periodic progress save while a Bunny class is actually playing —
  // independent of the timeupdate event's own frequency, so this is a
  // predictable ~15s cadence regardless of how often player.js fires it.
  useEffect(() => {
    if (!isBunny || !url) return;
    const interval = setInterval(() => {
      if (!isPlayingRef.current) return;
      reportProgress(bunnyPositionRef.current, bunnyDurationRef.current);
    }, PROGRESS_SAVE_MS);
    return () => clearInterval(interval);
  }, [isBunny, url, reportProgress]);

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
          const duration = e.target.getDuration();
          setYtDuration(duration);
          ytDurationRef.current = duration;
          setYtMuted(e.target.isMuted());
          setYtVolume((e.target.getVolume?.() ?? 100) / 100);
          setYtBuffering(false);
          setQualityLevels(e.target.getAvailableQualityLevels?.() ?? []);
          setQualityState(e.target.getPlaybackQuality?.() ?? 'auto');
          setSpeedState(e.target.getPlaybackRate?.() ?? 1);
          // Resume playback — same "not trivially close to start or end"
          // rule as the Bunny path above, applied exactly once per mount.
          if (!resumeAppliedRef.current && resumeSeconds && resumeSeconds > 5) {
            resumeAppliedRef.current = true;
            if (!duration || duration - resumeSeconds > 10) {
              e.target.seekTo(resumeSeconds, true);
              setYtCurrentTime(resumeSeconds);
              ytCurrentTimeRef.current = resumeSeconds;
            }
          }
        },
        onStateChange: (e) => {
          setYtPlaying(e.data === window.YT?.PlayerState.PLAYING);
          setYtBuffering(e.data === window.YT?.PlayerState.BUFFERING);
          if (e.data === window.YT?.PlayerState.PLAYING) {
            const duration = e.target.getDuration();
            setYtDuration(duration);
            ytDurationRef.current = duration;
          }
          // Save the moment playback pauses or ends — same reasoning as
          // the Bunny 'pause' handler above.
          if (e.data === window.YT?.PlayerState.PAUSED || e.data === window.YT?.PlayerState.ENDED) {
            reportProgress(ytCurrentTimeRef.current, ytDurationRef.current);
          }
        },
      },
    });

    return () => {
      player.destroy?.();
      ytPlayerRef.current = null;
    };
  }, [isYoutube, ytApiReady, url, resumeSeconds, reportProgress]);

  // --- YouTube: poll current time while playing to drive the seek bar.
  // There's no push-based "timeupdate" event in this API — polling is
  // the documented way to track progress.
  useEffect(() => {
    if (!isYoutube || !ytPlaying) return;
    const interval = setInterval(() => {
      if (ytSeekingRef.current) return; // don't fight an in-progress drag
      const yp = ytPlayerRef.current;
      if (!yp) return;
      const t = yp.getCurrentTime();
      setYtCurrentTime(t);
      ytCurrentTimeRef.current = t;
      const buffered = yp.getVideoLoadedFraction?.();
      if (typeof buffered === 'number') setYtBufferedFraction(buffered);
      // Also re-read the real playback quality — YouTube can silently
      // switch this on its own (bandwidth changes, or just overriding a
      // manual selection), so this keeps the settings menu honest instead
      // of showing whatever was last clicked.
      const liveQuality = yp.getPlaybackQuality?.();
      if (liveQuality) setQualityState(liveQuality);
    }, YT_TIME_POLL_MS);
    return () => clearInterval(interval);
  }, [isYoutube, ytPlaying]);

  // Periodic "resume playback" checkpoint while a YouTube class is
  // actually playing — same cadence/purpose as the Bunny interval above.
  useEffect(() => {
    if (!isYoutube || !ytPlaying) return;
    const interval = setInterval(() => {
      reportProgress(ytCurrentTimeRef.current, ytDurationRef.current);
    }, PROGRESS_SAVE_MS);
    return () => clearInterval(interval);
  }, [isYoutube, ytPlaying, reportProgress]);

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

  // Close the settings menu on any click outside it (mirrors the pattern
  // used by VideoDownloadButton's own menu).
  useEffect(() => {
    if (!settingsOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
        setSettingsPanel('main');
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [settingsOpen]);

  function changeSpeed(rate: number) {
    ytPlayerRef.current?.setPlaybackRate(rate);
    setSpeedState(rate);
    setSettingsOpen(false);
    setSettingsPanel('main');
    showHint(rate === 1 ? 'Normal speed' : `${rate}×`);
  }

  // NOTE: as of Google's own IFrame API docs, getPlaybackQuality,
  // setPlaybackQuality, and getAvailableQualityLevels are officially
  // "no longer supported" — setPlaybackQuality is now a documented no-op
  // with zero effect on what the viewer sees, for every embed, not just
  // this one. There is no client-side workaround; this isn't fixable from
  // this file. See https://developers.google.com/youtube/iframe_api_reference
  // ("Deprecations and changes" section). This is still called for the
  // rare case where the embed itself reports more than one real level
  // (see the qualityLevels.length > 1 branch below) — best-effort only.
  function changeQuality(level: string) {
    ytPlayerRef.current?.setPlaybackQuality(level);
    setQualityState(level);
    setSettingsOpen(false);
    setSettingsPanel('main');
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

  function changeVolume(value: number) {
    const yp = ytPlayerRef.current;
    if (!yp) return;
    const clamped = Math.min(1, Math.max(0, value));
    yp.setVolume(clamped * 100);
    setYtVolume(clamped);
    if (clamped === 0) {
      if (!yp.isMuted()) yp.mute();
      setYtMuted(true);
    } else if (yp.isMuted()) {
      yp.unMute();
      setYtMuted(false);
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

  // Drag-to-seek on the custom track below (a plain <input type=range>
  // can't easily grow a buffered-bar + hover-thumb visual across
  // browsers, so this is a bare div + pointer events instead).
  function handleSeekPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const track = e.currentTarget;
    const duration = ytDuration || 0;
    if (!duration) return;
    ytSeekingRef.current = true;
    const ratioFromEvent = (clientX: number) => {
      const rect = track.getBoundingClientRect();
      return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    };
    onSeekBarChange(ratioFromEvent(e.clientX) * duration);
    track.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => onSeekBarChange(ratioFromEvent(ev.clientX) * duration);
    const onUp = (ev: PointerEvent) => {
      commitSeekBar(ratioFromEvent(ev.clientX) * duration);
      track.releasePointerCapture(ev.pointerId);
      track.removeEventListener('pointermove', onMove);
      track.removeEventListener('pointerup', onUp);
    };
    track.addEventListener('pointermove', onMove);
    track.addEventListener('pointerup', onUp);
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
              (controls=0 above). Hover-to-reveal on desktop (matches the
              requested behavior), but always shown while paused or while
              the settings menu is open — paused-visible is also the
              practical fallback for touch devices, which have no hover
              state at all. Floating glass pill (not edge-to-edge), with a
              two-row layout: drag-to-seek track on top, controls below —
              same shape as a typical polished HLS player control bar. */}
          <div
            onClick={(e) => e.stopPropagation()}
            className={`absolute inset-x-2 sm:inset-x-3 bottom-2 sm:bottom-3 z-30 rounded-2xl border border-white/10 bg-black/50 px-2.5 pb-2 pt-3 shadow-[0_12px_36px_-8px_rgba(0,0,0,0.6)] backdrop-blur-xl transition-all duration-300 sm:px-4 sm:pb-2.5 sm:pt-3.5 ${
              !ytPlaying || settingsOpen
                ? 'translate-y-0 opacity-100'
                : 'pointer-events-none translate-y-2 opacity-0 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100'
            }`}
          >
            {/* Seek track: base (full), buffered (loaded fraction), played
                (current position), and a thumb that only appears on hover
                — same visual language as the reference control bar. */}
            <div
              onPointerDown={handleSeekPointerDown}
              role="slider"
              aria-label="Seek"
              aria-valuemin={0}
              aria-valuemax={ytDuration || 0}
              aria-valuenow={ytCurrentTime}
              className="group/seek relative mb-2.5 flex h-1.5 w-full cursor-pointer items-center transition-all duration-150 hover:h-2"
            >
              <div className="absolute left-0 right-0 h-full rounded-full bg-white/20" />
              <div
                className="absolute left-0 h-full rounded-full bg-white/35"
                style={{ width: `${Math.min(100, ytBufferedFraction * 100)}%` }}
              />
              <div
                className="absolute left-0 h-full rounded-full bg-gradient-to-r from-signal to-signal/70 shadow-[0_0_10px_-1px] shadow-signal/70"
                style={{ width: `${ytDuration ? Math.min(100, (ytCurrentTime / ytDuration) * 100) : 0}%` }}
              />
              <div
                className="absolute -ml-1.5 h-3 w-3 scale-75 rounded-full bg-white opacity-0 shadow-[0_2px_8px_rgba(0,0,0,0.5)] ring-2 ring-signal transition-all duration-150 group-hover/seek:scale-100 group-hover/seek:opacity-100 group-hover/seek:h-4 group-hover/seek:w-4"
                style={{ left: `${ytDuration ? Math.min(100, (ytCurrentTime / ytDuration) * 100) : 0}%` }}
              />
            </div>

            <div className="flex items-center gap-1 sm:gap-1.5 text-white">
              <button onClick={togglePlayPause} aria-label={ytPlaying ? 'Pause' : 'Play'} className={CTRL_BTN_CLASS}>
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

              <button onClick={() => seek(-SEEK_SECONDS)} aria-label="Back 10 seconds" className={CTRL_BTN_CLASS}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M6 12a8 8 0 1 1 2.4 5.7M6 12v5M6 12H1"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <text x="12" y="15" fontSize="7" fill="currentColor" textAnchor="middle" fontFamily="monospace">
                    10
                  </text>
                </svg>
              </button>

              <button onClick={() => seek(SEEK_SECONDS)} aria-label="Forward 10 seconds" className={CTRL_BTN_CLASS}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M18 12a8 8 0 1 0-2.4 5.7M18 12v5M18 12h5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <text x="12" y="15" fontSize="7" fill="currentColor" textAnchor="middle" fontFamily="monospace">
                    10
                  </text>
                </svg>
              </button>

              {/* Volume: icon + a slider that only widens on hover (desktop) —
                  collapsed to just the mute toggle on touch/narrow screens,
                  same as the reference bar hiding it below sm. */}
              <div className="group/vol hidden items-center gap-1 sm:flex">
                <button onClick={toggleMute} aria-label={ytMuted ? 'Unmute' : 'Mute'} className={CTRL_BTN_CLASS}>
                  {ytMuted || ytVolume === 0 ? (
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
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={ytMuted ? 0 : ytVolume}
                  onChange={(e) => changeVolume(Number(e.target.value))}
                  aria-label="Volume"
                  className="w-0 cursor-pointer overflow-hidden accent-signal transition-[width] duration-200 group-hover/vol:w-16"
                />
              </div>

              <span className="ml-1 whitespace-nowrap text-xs font-semibold tabular-nums text-white/95 sm:text-sm">
                {formatTime(ytCurrentTime)} <span className="font-normal text-white/50">/</span>{' '}
                {formatTime(ytDuration)}
              </span>

              <div className="flex-1" />

              <div ref={settingsRef} className="relative">
                <button
                  onClick={() => {
                    setSettingsOpen((v) => !v);
                    setSettingsPanel('main');
                  }}
                  aria-label="Settings"
                  className={CTRL_BTN_CLASS}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                    <path
                      d="m19.4 13-.1-1-.1-1 1.6-1.3-2-3.4-2 .6-1.7-1-.3-2h-4l-.3 2-1.7 1-2-.6-2 3.4L6.3 11l-.1 1 .1 1-1.6 1.3 2 3.4 2-.6 1.7 1 .3 2h4l.3-2 1.7-1 2 .6 2-3.4L19.4 13Z"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinejoin="round"
                    />
                    <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.4" />
                  </svg>
                </button>

                {settingsOpen && (
                <div className="absolute bottom-8 right-0 z-20 w-48 overflow-hidden rounded-2xl border border-white/10 bg-black/75 py-1.5 text-xs text-white shadow-2xl backdrop-blur-2xl">
                  {settingsPanel === 'main' && (
                    <>
                      <button
                        onClick={() => setSettingsPanel('speed')}
                        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition hover:bg-white/10"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="shrink-0 text-white/70">
                          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
                          <path
                            d="M12 12 15.5 8.5M12 7v1.2M12 16.8V18M6.2 12H7.4M16.6 12h1.2"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                          />
                        </svg>
                        <span className="flex-1">Speed</span>
                        <span className="flex items-center gap-1 text-white/50">
                          {speed === 1 ? 'Normal' : `${speed}×`}
                          <span aria-hidden>›</span>
                        </span>
                      </button>
                      <button
                        onClick={() => setSettingsPanel('quality')}
                        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition hover:bg-white/10"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="shrink-0 text-white/70">
                          <rect x="3" y="6" width="18" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
                          <path
                            d="M7.5 10v4M10.5 10v4M7.5 12h3M13.5 10v4h1.6a1.4 1.4 0 0 0 1.4-1.4v-1.2a1.4 1.4 0 0 0-1.4-1.4H13.5Z"
                            stroke="currentColor"
                            strokeWidth="1.3"
                            strokeLinejoin="round"
                          />
                        </svg>
                        <span className="flex-1">Quality</span>
                        <span className="flex items-center gap-1 text-white/50">
                          {QUALITY_LABELS[quality] ?? quality}
                          <span aria-hidden>›</span>
                        </span>
                      </button>
                      <p className="px-3.5 pb-1.5 pt-0.5 text-[10px] leading-snug text-white/35">
                        YouTube manages quality automatically for embedded players.
                      </p>
                    </>
                  )}

                  {settingsPanel === 'speed' && (
                    <>
                      <button
                        onClick={() => setSettingsPanel('main')}
                        className="flex w-full items-center gap-1.5 border-b border-white/10 px-3.5 py-2.5 text-left font-medium"
                      >
                        <span aria-hidden>‹</span> Speed
                      </button>
                      {SPEED_OPTIONS.map((rate) => (
                        <button
                          key={rate}
                          onClick={() => changeSpeed(rate)}
                          className="flex w-full items-center justify-between px-3.5 py-2 text-left transition hover:bg-white/10"
                        >
                          <span className={rate === speed ? 'text-signal-glow' : ''}>
                            {rate === 1 ? 'Normal' : `${rate}×`}
                          </span>
                          {speed === rate && (
                            <span aria-hidden className="text-signal-glow">
                              ✓
                            </span>
                          )}
                        </button>
                      ))}
                    </>
                  )}

                  {settingsPanel === 'quality' && (
                    <>
                      <button
                        onClick={() => setSettingsPanel('main')}
                        className="flex w-full items-center gap-1.5 border-b border-white/10 px-3.5 py-2.5 text-left font-medium"
                      >
                        <span aria-hidden>‹</span> Quality
                      </button>
                      {qualityLevels.length > 1 ? (
                        // Genuinely reported by this embed (rare, but the API
                        // allows it) — selecting one is still just a request
                        // YouTube is free to ignore, so this stays honest
                        // rather than promising a guaranteed switch.
                        qualityLevels.map((level) => (
                          <button
                            key={level}
                            onClick={() => changeQuality(level)}
                            className="flex w-full items-center justify-between px-3.5 py-2 text-left transition hover:bg-white/10"
                          >
                            <span className={level === quality ? 'text-signal-glow' : ''}>
                              {QUALITY_LABELS[level] ?? level}
                            </span>
                            {quality === level && (
                              <span aria-hidden className="text-signal-glow">
                                ✓
                              </span>
                            )}
                          </button>
                        ))
                      ) : (
                        <div className="px-3.5 py-3 text-left">
                          <p className="flex items-center gap-1.5">
                            <span className="text-signal-glow">
                              {QUALITY_LABELS[quality] ?? quality}
                            </span>
                            <span className="text-white/40">— currently playing</span>
                          </p>
                          <p className="mt-1.5 text-[10px] leading-snug text-white/40">
                            YouTube&apos;s embedded player no longer accepts manual
                            quality requests — it picks resolution itself based on
                            connection speed and window size, and there&apos;s no
                            way for any site embedding YouTube to override that.
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            <button onClick={toggleFullscreen} aria-label="Fullscreen" className={CTRL_BTN_CLASS}>
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
