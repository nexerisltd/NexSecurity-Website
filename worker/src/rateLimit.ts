/**
 * KV-based approximation of ../../lib/rateLimit.ts's in-memory sliding
 * window — a fixed-window counter rather than a true sliding window,
 * since KV has no atomic increment and is only eventually consistent.
 * Can slightly under- or over-count for the same key under heavy
 * concurrent traffic; a reasonable approximation, not exact parity —
 * same real-world caveat lib/rateLimit.ts's own comment already makes
 * about its in-memory Map on Vercel's multi-instance serverless
 * runtime.
 */

export async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  const bucketKey = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;
  const current = await kv.get(bucketKey);
  const count = current ? parseInt(current, 10) : 0;
  if (count >= limit) return false;
  // expirationTtl a little past the window so a bucket never outlives
  // its own usefulness by more than a few seconds.
  await kv.put(bucketKey, String(count + 1), { expirationTtl: windowSeconds + 5 });
  return true;
}
