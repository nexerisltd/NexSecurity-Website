import 'server-only';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Encrypts (not just signs) the payload the Cloudflare Worker
 * (stream.<domain>, see worker/src/index.ts) needs to serve an HLS
 * request without ever calling Supabase itself. The only caller is
 * app/api/video/[id]/stream-token/route.ts; worker/src/streamToken.ts
 * is this file's decrypt-side counterpart.
 *
 * AES-256-GCM rather than a plain HMAC-signed token: the payload embeds
 * source_ref and referer_header — the CDN's real playlist URL and the
 * secret Referer value some source CDNs require (see lib/m3u8.ts) — and
 * this token is handed to the BROWSER as a `t=` query param so hls.js
 * can attach it to every request. A signature alone (base64 + HMAC)
 * proves the payload wasn't tampered with but does nothing to stop
 * anyone opening devtools, copying that value, and base64-decoding it
 * to read the plaintext Referer secret straight out of a Network tab —
 * which would quietly break the exact protection this whole feature
 * exists to relocate, not preserve. AEAD encryption keeps that secret
 * opaque to the client while still letting the Worker recover it
 * locally (decrypt with the same shared secret) with no per-segment
 * database round trip.
 */

export type StreamTokenPayload = {
  /** Video id this token is valid for — the Worker rejects a token
   * whose vid doesn't match the :videoId path segment it was used on,
   * so a token can't be replayed against a different video. */
  vid: string;
  /** Opaque per-user identifier (sha256 of the email, truncated — see
   * the route) — only used for the Worker's own KV rate limiting,
   * never anything that needs to round-trip back to Supabase. */
  uid: string;
  /** Epoch seconds. */
  exp: number;
  /** The actual source CDN playlist URL — see lib/m3u8.ts. */
  sr: string;
  /** Admin-configured Referer value for this video, or null. */
  rh: string | null;
};

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce — the AES-GCM recommended size

function deriveKey(secret: string): Buffer {
  // SHA-256 of the raw secret gives a fixed 32-byte key regardless of
  // how STREAM_TOKEN_SECRET itself was generated — the Worker side
  // (worker/src/streamToken.ts) derives its key the same way via Web
  // Crypto's digest(), so both sides always agree on the same AES key
  // from the same secret string without ever exchanging the key itself.
  return createHash('sha256').update(secret, 'utf8').digest();
}

function getSecret(): string {
  const secret = process.env.STREAM_TOKEN_SECRET;
  if (!secret) throw new Error('STREAM_TOKEN_SECRET is not configured.');
  return secret;
}

/**
 * Returns iv (12 bytes) || authTag (16 bytes) || ciphertext, all
 * base64url-joined into one opaque token string. See
 * worker/src/streamToken.ts for how these bytes get re-sliced back out
 * for Web Crypto's subtle.decrypt (which wants the tag appended to the
 * ciphertext, not split out the way Node's API returns it).
 */
export function createStreamToken(payload: StreamTokenPayload): string {
  const key = deriveKey(getSecret());
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64url');
}
