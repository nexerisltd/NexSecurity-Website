/**
 * Worker-side counterpart of ../../lib/streamToken.ts (Next.js app).
 * Decrypts the token app/api/video/[id]/stream-token/route.ts minted,
 * recovering videoId/source_ref/referer_header locally — no Supabase
 * call, no network round trip, per request. See that file's header
 * comment for why this is AES-256-GCM encryption and not just an
 * HMAC signature.
 */

export type StreamTokenPayload = {
  vid: string;
  uid: string;
  exp: number;
  sr: string;
  rh: string | null;
};

const IV_LENGTH = 12;
const TAG_LENGTH_BYTES = 16;

function base64UrlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

let cachedKey: { secret: string; key: CryptoKey } | null = null;

async function deriveKey(secret: string): Promise<CryptoKey> {
  // Cached across requests within the same isolate — Workers reuse a
  // warm isolate for many requests in a row, and re-hashing + re-
  // importing the same secret on every single segment request would be
  // pure waste. Keyed on the secret value itself so a `wrangler secret
  // put` rotation (which spins up a fresh isolate anyway) can never
  // serve a stale key.
  if (cachedKey && cachedKey.secret === secret) return cachedKey.key;
  const secretBytes = new TextEncoder().encode(secret);
  const digest = await crypto.subtle.digest('SHA-256', secretBytes);
  const key = await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['decrypt']);
  cachedKey = { secret, key };
  return key;
}

/**
 * Returns the decrypted payload if `token` is well-formed AND its
 * AES-GCM auth tag verifies against the shared STREAM_TOKEN_SECRET —
 * null for anything else (malformed, wrong secret, tampered).
 * Callers must still check `exp` and `vid` themselves (see index.ts) —
 * a successfully-decrypted token can still be an expired or
 * wrong-video one.
 */
export async function decryptStreamToken(token: string, secret: string): Promise<StreamTokenPayload | null> {
  try {
    const raw = base64UrlToBytes(token);
    if (raw.length < IV_LENGTH + TAG_LENGTH_BYTES) return null;
    const iv = raw.slice(0, IV_LENGTH);
    // Web Crypto wants the auth tag appended to the ciphertext, not
    // split out separately the way Node's createDecipheriv/getAuthTag
    // pair needs it — lib/streamToken.ts lays the bytes out as
    // iv || tag || ciphertext, so this just re-orders them into
    // iv || ciphertext || tag for subtle.decrypt.
    const tag = raw.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH_BYTES);
    const ciphertext = raw.slice(IV_LENGTH + TAG_LENGTH_BYTES);
    const combined = new Uint8Array(ciphertext.length + tag.length);
    combined.set(ciphertext, 0);
    combined.set(tag, ciphertext.length);

    const key = await deriveKey(secret);
    const plaintextBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, combined);
    const json = new TextDecoder().decode(plaintextBuf);
    const parsed = JSON.parse(json);
    if (
      typeof parsed?.vid === 'string' &&
      typeof parsed?.uid === 'string' &&
      typeof parsed?.exp === 'number' &&
      typeof parsed?.sr === 'string' &&
      (typeof parsed?.rh === 'string' || parsed?.rh === null)
    ) {
      return parsed as StreamTokenPayload;
    }
    return null;
  } catch {
    // Wrong secret, tampered ciphertext, or just garbage in `t=` — all
    // collapse to the same "reject" outcome from the caller's side.
    return null;
  }
}
