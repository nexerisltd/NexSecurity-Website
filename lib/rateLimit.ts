/**
 * In-memory, per-isolate rate limiter — deliberately NOT Workers KV.
 *
 * The original KV-based version did a get() + put() on every single
 * request, including cache HITS (the rate-limit check runs before the
 * cache lookup in index.ts, since a rate-limited client shouldn't get
 * free cached bytes either). At real class-sized traffic that's easily
 * thousands of KV writes/day per active video — Cloudflare's free tier
 * is only 1,000 writes/day total, account-wide, so this alone was
 * enough to blow through it and trigger Cloudflare's "nearing the daily
 * cap" warning, with 429s and a forced Workers Paid plan upgrade next.
 *
 * This Worker's rate limit was only ever meant as a defense-in-depth
 * abuse backstop, never the actual access-control decision — the real
 * one (is this viewer authorized for this video, right now) lives in
 * ../../app/api/video/[id]/stream-token/route.ts, re-checked against
 * Supabase every time a token is minted (~every 45s per viewer, see
 * VideoPlayer.tsx). A per-isolate in-memory Map, same approach
 * ../../lib/rateLimit.ts already uses on the Vercel side, is more than
 * adequate for a backstop and costs nothing — the trade-off is the same
 * one lib/rateLimit.ts documents for itself: this state isn't shared
 * across isolates/edge locations, so a determined abuser spread across
 * many simultaneous connections could see a slightly higher effective
 * ceiling than RATE_LIMIT nominally suggests. Fine for a backstop; not
 * something to rely on as the actual security boundary.
 */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function checkRateLimit(key: string, limit: number, windowSeconds: number): boolean {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const existing = buckets.get(key);

  if (!existing || existing.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (existing.count >= limit) return false;

  existing.count += 1;
  return true;
}
