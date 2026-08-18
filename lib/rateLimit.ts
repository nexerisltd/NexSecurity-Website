import 'server-only';

/**
 * Minimal in-memory sliding-window rate limiter.
 *
 * IMPORTANT LIMITATION: Vercel serverless functions are not guaranteed
 * to reuse the same instance/memory between requests, and this state is
 * NOT shared across instances or regions. This is fine for development
 * and as a defense-in-depth backstop, but for real production traffic
 * replace this with a shared store — Upstash Redis + @upstash/ratelimit
 * is the standard pairing with Vercel and is a near drop-in swap for
 * the `checkRateLimit` function below.
 */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1 };
  }

  if (existing.count >= limit) {
    return { allowed: false, remaining: 0 };
  }

  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count };
}

/** Best-effort client identifier for rate limiting (not a security identity). */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() ?? 'unknown';
}
