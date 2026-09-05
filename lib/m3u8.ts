/**
 * "m3u8" provider: source_ref is the .m3u8 (HLS) playlist URL itself, and
 * referer_header (see lib/validation.ts / supabase/migrations/0008) is the
 * Referer value some hotlink-protected CDNs require before they'll serve
 * it. Browsers refuse to let client-side JS set a custom Referer header
 * on fetch()/XHR — it's a "forbidden header name", see
 * https://fetch.spec.whatwg.org/#forbidden-header-name — so hls.js's own
 * xhrSetup can't do this either. The only way to honor an arbitrary
 * Referer is a server-side proxy that attaches it itself; this file backs
 * app/api/video/[id]/hls-proxy/route.ts, which is that proxy.
 */

const PLAYLIST_HEADER_RE = /^#EXTM3U/;

export function looksLikePlaylist(text: string): boolean {
  return PLAYLIST_HEADER_RE.test(text.trimStart());
}

/** Same "look like a real browser" spoofing lib/bunny.ts already does for
 * its own hotlink-protected pull zone (see bunnyFetchHeaders in
 * app/api/video/[id]/hls-download/route.ts) — reused here since it's
 * exactly the same problem, just for an admin-supplied CDN instead of
 * Bunny's, with an admin-supplied Referer instead of this site's own. */
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
// before this server ever fetches an admin-supplied URL on a logged-in
// user's behalf. Not exhaustive DNS-rebinding protection — good enough
// for "an admin typo'd, or an attacker supplied, a .m3u8 pointing back at
// our own infrastructure", which is the realistic risk here.
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

// Sub-resource URLs are round-tripped through the proxy as a query param
// rather than a path segment, so any absolute https URL (arbitrary length,
// arbitrary characters) survives intact.
export function encodeProxyTarget(url: string): string {
  return Buffer.from(url, 'utf8').toString('base64url');
}

export function decodeProxyTarget(token: string): string | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    return decoded || null;
  } catch {
    return null;
  }
}

/**
 * Rewrites every URI a media/master playlist references — variant
 * streams, segments, #EXT-X-KEY, #EXT-X-MAP — to point back through the
 * proxy route instead, resolving relative playlist URIs against baseUrl
 * first so they keep working once rewritten to an absolute proxy URL.
 * `proxyBase` is e.g. "/api/video/<id>/hls-proxy".
 */
export function rewritePlaylist(text: string, baseUrl: string, proxyBase: string): string {
  const proxied = (uri: string) => `${proxyBase}?u=${encodeProxyTarget(new URL(uri, baseUrl).toString())}`;

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
