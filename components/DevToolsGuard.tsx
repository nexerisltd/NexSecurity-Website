'use client';

import { useEffect, useState } from 'react';
import { SecurityIncidentScreen, type SecurityIncidentInfo } from '@/components/SecurityIncidentScreen';

// How much bigger the OUTER (whole browser chrome) window is than the
// INNER (actual page viewport) before it's treated as "DevTools is
// probably docked open" — a docked DevTools panel eats a large,
// specific chunk of one dimension. Ordinary browser chrome (address
// bar, bookmarks bar, OS window decorations) never gets anywhere close
// to this on either axis, which is what keeps this from false-firing on
// every normal page load.
const DOCK_THRESHOLD_PX = 220;
const CHECK_INTERVAL_MS = 1000;

/**
 * Best-effort, frontend-only DevTools deterrent — mounted once in
 * app/learn/layout.tsx, same as components/DisableRightClick.tsx.
 *
 * HOW THIS ACTUALLY WORKS: measures the gap between window.outerWidth/
 * outerHeight (the whole browser window) and window.innerWidth/
 * innerHeight (the actual page viewport) every second. A DevTools panel
 * DOCKED to a side/bottom of the browser window carves a large, fixed
 * chunk out of that gap that ordinary browser chrome never does.
 *
 * WHAT THIS DOES NOT CATCH, ON PURPOSE — stated plainly rather than
 * oversold as some unbreakable mechanism (per the feature's own
 * requirement that this be a deterrent, not a security guarantee):
 *  - DevTools opened UNDOCKED (its own separate window) — the main
 *    window's inner/outer gap never changes, so this never fires.
 *  - DevTools opened on a second monitor, or via a remote debugging
 *    connection (chrome://inspect from another machine) — same reason.
 *  - Browser extensions or command-line flags that alter window
 *    reporting.
 * This trade-off was deliberate: the alternative "debugger;" statement
 * timing trick catches a couple of those cases too, but pauses page
 * execution for a beat on every single check even when nothing is
 * wrong, which reads as actual jank on a slower device — not an
 * acceptable cost for a deterrent this codebase can't even guarantee
 * catches everything anyway.
 *
 * Skips entirely on touch-primary devices with no real outerWidth
 * support (most mobile browsers report outerWidth as 0 or equal to
 * innerWidth) — there's no docked-panel concept to detect there, and a
 * naive check would either always-false-negative or false-positive on
 * viewport chrome (address bar show/hide) that has nothing to do with
 * DevTools.
 *
 * `isAdmin` skips detection entirely: admins are a trusted role that
 * already bypasses device restriction (see isRestricted in
 * lib/auth.ts) and legitimately needs DevTools for actual admin/debug
 * work on this same site. app/api/security/incident/route.ts also
 * refuses to record an incident for an admin server-side, so this isn't
 * only a client-side skip a modified/cached bundle could quietly defeat.
 */
export function DevToolsGuard({ userName, isAdmin }: { userName?: string | null; isAdmin?: boolean }) {
  const [incident, setIncident] = useState<SecurityIncidentInfo | null>(null);

  useEffect(() => {
    if (isAdmin) return;
    if (incident) return; // already locked — stop checking, nothing left to detect
    if (typeof window === 'undefined' || !window.outerWidth) return;

    let cancelled = false;

    async function reportAndLock() {
      // Practical "stop/hide protected content" — pausing whatever
      // video is actually playing is the one concrete, honest thing a
      // page-side script can do; it cannot pull anything already
      // rendered/loaded back out of a DevTools-open tab's memory, and
      // this deliberately doesn't claim otherwise anywhere on the lock
      // screen itself.
      document.querySelectorAll('video').forEach((v) => v.pause());
      document.body.style.overflow = 'hidden';

      try {
        const res = await fetch('/api/security/incident', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            detectionType: 'DEVTOOLS_DETECTED',
            screen_width: window.screen?.width,
            screen_height: window.screen?.height,
            viewport_width: window.innerWidth,
            viewport_height: window.innerHeight,
          }),
        });
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as SecurityIncidentInfo & { skip?: boolean };
          if (data.skip) return; // server-side admin exemption — see that route's comment
          setIncident(data);
        } else {
          // Recording failed server-side (network blip, rate limit) —
          // still lock the page with whatever this browser already
          // knows about itself, rather than leaving protected content
          // visible just because the report call failed.
          setIncident({
            nsUserId: 'Unavailable',
            accountIdentifier: userName ?? 'Unavailable',
            deviceName: 'Unavailable',
            deviceId: 'Unavailable',
            deviceApprovalStatus: 'Unavailable',
            ip: 'Unavailable',
            os: 'Unavailable',
            browser: 'Unavailable',
            detectionTime: new Date().toISOString(),
            detectionType: 'DEVTOOLS_DETECTED',
            attemptNumber: 0,
            remainingAttempts: null,
          });
        }
      } catch {
        if (!cancelled) {
          setIncident({
            nsUserId: 'Unavailable',
            accountIdentifier: userName ?? 'Unavailable',
            deviceName: 'Unavailable',
            deviceId: 'Unavailable',
            deviceApprovalStatus: 'Unavailable',
            ip: 'Unavailable',
            os: 'Unavailable',
            browser: 'Unavailable',
            detectionTime: new Date().toISOString(),
            detectionType: 'DEVTOOLS_DETECTED',
            attemptNumber: 0,
            remainingAttempts: null,
          });
        }
      }
    }

    const interval = setInterval(() => {
      const widthGap = window.outerWidth - window.innerWidth;
      const heightGap = window.outerHeight - window.innerHeight;
      if (widthGap > DOCK_THRESHOLD_PX || heightGap > DOCK_THRESHOLD_PX) {
        clearInterval(interval);
        void reportAndLock();
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incident, isAdmin]);

  if (!incident) return null;
  return <SecurityIncidentScreen incident={incident} />;
}
