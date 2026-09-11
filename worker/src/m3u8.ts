/**
 * Ported near-verbatim from ../../lib/m3u8.ts (Next.js app) — same
 * isSafeProxyTarget SSRF guard, same m3u8FetchHeaders spoofing, same
 * playlist rewriting. encodeProxyTarget/decodeProxyTarget use Web
 * Crypto-adjacent base64url helpers instead of Node's Buffer — the
 * original used Buffer since Next.js runs on Node, but pulling in
 * @types/node here just to keep one `Buffer.from(...).toString(...)`
 * call wasn't worth it when atob/btoa do the exact same job natively in
 * a Worker. rewritePlaylist also gained an `extraQuery` param (see its
 * own comment below). Keep this in sync with lib/m3u8.ts if that file's
 * SSRF guard or header spoofing ever changes.
 */

const PLAYLIST_HEADER_RE = /^#EXTM3U/;

export function looksLikePlaylist(text: string): boolean {
  return PLAYLIST_HEADER_RE.test(text.trimStart());
}

export function m3u8FetchHeaders(referer: string | null): HeadersInit {
  let origin: string | null = null;
  if (referer) {
    try {
      origin = new URL(referer).origin;
    } catch {
      // Not a real absolute URL — still send it as Referer verbatim
      // (some CDNs only string-match a prefix), just skip Origin.
    }
  }
  return {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    ...(referer ? { Referer: referer } : {}),
    ...(origin ? { Origin: origin } : {}),
  };
}

// Blocks the obvious SSRF targets (loopback, link-local, RFC1918, etc.)
// before this Worker ever fetches an admin-supplied URL on a viewer's
// behalf. Not exhaustive DNS-rebinding protection — same "good enough"
// scope as the original in lib/m3u8.ts.
const BLOCKED_HOSTNAME_RE = /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[?::1\]?$|f[cd][0-9a-f]{2}:)/i;

function isPrivateHostname(hostname: string): boolean {
  if (BLOCKED_HOSTNAME_RE.test(hostname)) return true;
  const m = hostname.match(/^172\.(\d{1,3})\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return false;
}

export function isSafeProxyTarget(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    if (isPrivateHostname(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodeProxyTarget(url: string): string {
  return base64UrlEncode(new TextEncoder().encode(url));
}

export function decodeProxyTarget(token: string): string | null {
  try {
    const decoded = new TextDecoder().decode(base64UrlDecode(token));
    return decoded || null;
  } catch {
    return null;
  }
}

/**
 * Same rewriting logic as lib/m3u8.ts's rewritePlaylist, plus one
 * addition: `extraQuery` gets appended to every rewritten sub-resource
 * URL. The Next.js version never needed this — its proxy route sat
 * behind the same session cookie for every request. This Worker instead
 * authenticates each request via the `t=` stream token in the query
 * string (see index.ts), so every rewritten segment/key/variant URL
 * needs one riding along too, or it'd 401 the instant hls.js requested
 * it. `proxyBase` is e.g. "/hls/<videoId>"; `extraQuery` is e.g.
 * "t=<token>".
 */
export function rewritePlaylist(text: string, baseUrl: string, proxyBase: string, extraQuery: string): string {
  const proxied = (uri: string) =>
    `${proxyBase}?u=${encodeProxyTarget(new URL(uri, baseUrl).toString())}&${extraQuery}`;

  return text
    .split('\n')
    .map((rawLine) => {
      const line = rawLine.replace(/\r$/, '');
      if (line.startsWith('#EXT-X-KEY') || line.startsWith('#EXT-X-MAP')) {
        return line.replace(/URI="([^"]+)"/, (_m, uri: string) => `URI="${proxied(uri)}"`);
      }
      if (!line || line.startsWith('#')) return line;
      return proxied(line.trim());
    })
    .join('\n');
}
