import 'server-only';
import { headers } from 'next/headers';

/**
 * Best-effort client IP. On Vercel, x-forwarded-for carries the real
 * client IP as the first entry (Vercel's edge appends its own hops after
 * it). This is not spoof-proof against a client who controls their own
 * proxy chain in unusual setups, but it's what every reverse-proxy-based
 * IP allowlist relies on in practice.
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
 * A coarse "device" label derived from the User-Agent header: OS +
 * browser family (e.g. "Windows · Chrome", "Android · Chrome").
 *
 * IMPORTANT: this is NOT a hardware device model. Modern browsers
 * deliberately no longer expose that (Chrome's User-Agent Reduction,
 * Safari, etc. all limit it for privacy reasons) — there is no reliable,
 * spoof-resistant way to read "iPhone 14" vs "iPhone 13" from a plain web
 * request. Combined with IP address, this label is a practical proxy for
 * "which browser install on which network", which is enough to tell two
 * different people apart in the vast majority of real sharing cases.
 */
export function getDeviceLabel(): string {
  const ua = headers().get('user-agent') ?? '';
  return parseDeviceLabel(ua);
}

export function parseDeviceLabel(ua: string): string {
  if (!ua) return 'Unknown device';

  let os = 'Unknown OS';
  if (/windows/i.test(ua)) os = 'Windows';
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

  return `${os} · ${browser}`;
}
