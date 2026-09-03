import 'server-only';
import { cookies, headers } from 'next/headers';
import { DEVICE_ID_COOKIE } from '@/lib/deviceId';

/**
 * The device's persistent identity — planted by middleware.ts on first
 * visit (see lib/deviceId.ts) and never rotated. THIS, not IP, is what
 * lib/auth.ts matches against user_devices: it survives IP changes
 * (wifi -> mobile data), unlike the old IP+UA compound key.
 *
 * Returns null only on the rare request that reaches a server component
 * before middleware's Set-Cookie has round-tripped to the browser (e.g.
 * a prefetch that races the very first response) — callers must treat
 * that as "identity not yet established" rather than silently trusting
 * or silently rejecting it (see getAuth() in lib/auth.ts).
 */
export function getDeviceId(): string | null {
  return cookies().get(DEVICE_ID_COOKIE)?.value ?? null;
}

/**
 * Best-effort client IP. On Vercel, x-forwarded-for carries the real
 * client IP as the first entry (Vercel's edge appends its own hops after
 * it). This is not spoof-proof against a client who controls their own
 * proxy chain in unusual setups, but it's what every reverse-proxy-based
 * IP allowlist relies on in practice.
 *
 * IP is SECONDARY security information only from here on — logged per
 * device (user_devices.ip_history) for an admin reviewing activity, never
 * used to decide device identity itself. See lib/auth.ts.
 */
export function getClientIp(): string {
  const h = headers();
  const forwardedFor = h.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = h.get('x-real-ip');
  if (realIp) return realIp;
  return 'unknown';
}

/**
 * A human-readable "device" label derived from the User-Agent header: OS +
 * browser family (e.g. "Windows · Chrome", "Android · Chrome") — and, when
 * the browser is willing to share it, the actual hardware model too (e.g.
 * "Android (Pixel 7) · Chrome").
 *
 * IMPORTANT: this is NOT part of device identity, only a label — see
 * getDeviceId() above for the real thing. And the hardware model piece is
 * only ever available from Chromium browsers on Android via the
 * Sec-CH-UA-Model Client Hint (opted into in middleware.ts) — Safari
 * (iOS/macOS), Firefox, and desktop Chrome/Edge never send a model at all,
 * by deliberate browser policy, not a bug here. This is the same wall
 * every web app runs into (including Google's own "you're signed in on
 * these devices" page for browser sessions) — a phone model shown there
 * for a NATIVE app comes from Play Services/App attestation, not the web.
 */
export function getDeviceLabel(): string {
  const h = headers();
  const ua = h.get('user-agent') ?? '';
  const platformHint = h.get('sec-ch-ua-platform');
  const modelHint = h.get('sec-ch-ua-model');
  return parseDeviceLabel(ua, platformHint, modelHint);
}

export function parseDeviceLabel(ua: string, platformHint?: string | null, modelHint?: string | null): string {
  if (!ua && !platformHint) return 'Unknown device';

  // Sec-CH-UA-Platform (sent by default on every Chromium-based browser —
  // Chrome, Edge, Opera, Samsung Internet — no server opt-in required) is
  // checked FIRST and wins when present. It reports the browser's real
  // underlying OS even when the traditional User-Agent string has been
  // rewritten to impersonate a desktop OS, which is exactly what Chrome
  // for Android does when someone taps "Desktop site" — the UA string
  // becomes a generic "X11; Linux x86_64" with no mention of Android or
  // Mobile at all, which is what was showing up as "Linux" in the admin
  // panel for large numbers of perfectly ordinary Android users. The
  // header's value is a quoted string, e.g. "Android", "Windows",
  // "macOS", "Linux", "Chrome OS", or "Unknown" — strip the quotes and
  // trust it whenever it's a real answer.
  const hint = platformHint?.replace(/"/g, '').trim();

  let os = 'Unknown OS';
  if (hint && hint !== 'Unknown') {
    os = hint === 'Chrome OS' || hint === 'Chromium OS' ? 'Chrome OS' : hint;
  } else if (/windows/i.test(ua)) os = 'Windows';
  else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
  else if (/mac os x/i.test(ua)) os = 'macOS';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/linux/i.test(ua)) os = 'Linux';

  let browser = 'Unknown browser';
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/chrome\//i.test(ua) && !/edg\//i.test(ua) && !/opr\//i.test(ua)) browser = 'Chrome';
  else if (/opr\//i.test(ua)) browser = 'Opera';
  else if (/firefox\//i.test(ua)) browser = 'Firefox';
  else if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) browser = 'Safari';

  // Sec-CH-UA-Model, when the browser actually sends it (Android Chrome
  // and Chromium-based browsers ONLY, and only after Accept-CH has opted
  // in — see middleware.ts): a raw hardware model string like "Pixel 7"
  // or "SM-G991B". Slot it in next to the OS when present.
  const model = modelHint?.replace(/"/g, '').trim();
  const osWithModel = model ? `${os} (${model})` : os;

  return `${osWithModel} · ${browser}`;
}
