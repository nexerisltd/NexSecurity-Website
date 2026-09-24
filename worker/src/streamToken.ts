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
  ip: string;
  aid: string;
  exp: number;
  sr: string;
  rh: string | null;
};

/**
 * Web Crypto counterpart of ../../lib/streamToken.ts's hashForToken() —
 * same truncated-sha256-hex scheme, so a request's own IP hashes to the
 * exact same string the mint route computed for payload.ip. Used by
 * index.ts to check the IP binding on every playlist/segment request.
 */
export async function hashForToken(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.slice(0, 24);
}

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
  const key = await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  cachedKey = { secret, key };
  return key;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Encrypts a sub-resource URL (a variant playlist or segment URI a
 * playlist referenced) for the `u=` query param — see rewritePlaylist in
 * ./m3u8.ts, which is the only caller. This used to be encodeProxyTarget
 * in ./m3u8.ts, plain reversible base64 with NO encryption at all: the
 * real upstream CDN URL (Bunny's own .b-cdn.net address) sat in every
 * `u=` value in cleartext, one `atob()` away from anyone who looked —
 * completely bypassing the IP-binding/short-TTL/burst-detection this
 * whole token system exists for, since a copied `u=` value handed you
 * the raw CDN URL directly, usable forever, with none of this Worker's
 * checks ever running again. AES-256-GCM with the SAME
 * STREAM_TOKEN_SECRET as the `t=` token closes that: `u=` is now exactly
 * as opaque as `t=` is, and always was meant to be.
 */
export async function encryptProxyTarget(url: string, secret: string): Promise<string> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const plaintext = new TextEncoder().encode(url);
  // Web Crypto's AES-GCM encrypt() appends the auth tag to the
  // ciphertext itself (unlike Node's createCipheriv/getAuthTag, which
  // hand it back separately) — so the output here is already
  // ciphertext||tag, and only the IV needs prepending to match the
  // iv||ciphertext||tag layout decryptProxyTarget (and
  // decryptStreamToken above) expect.
  const cipherWithTag = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  const combined = new Uint8Array(IV_LENGTH + cipherWithTag.length);
  combined.set(iv, 0);
  combined.set(cipherWithTag, IV_LENGTH);
  return bytesToBase64Url(combined);
}

/** Decrypts a `u=` value produced by encryptProxyTarget above. Returns
 * null for anything malformed, tampered, or encrypted under a different
 * secret — same collapse-every-failure-to-null shape as
 * decryptStreamToken, for the same reason (see that function). */
export async function decryptProxyTarget(token: string, secret: string): Promise<string | null> {
  try {
    const raw = base64UrlToBytes(token);
    if (raw.length <= IV_LENGTH) return null;
    const iv = raw.slice(0, IV_LENGTH);
    const cipherWithTag = raw.slice(IV_LENGTH);
    const key = await deriveKey(secret);
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipherWithTag);
    const decoded = new TextDecoder().decode(plainBuf);
    return decoded || null;
  } catch {
    return null;
  }
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
      typeof parsed?.ip === 'string' &&
      typeof parsed?.aid === 'string' &&
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
