/**
 * Ported near-verbatim from ../../lib/m3u8.ts (Next.js app) — same
 * isSafeProxyTarget SSRF guard, same m3u8FetchHeaders spoofing, same
 * playlist rewriting. Diverges from that file in one important way:
 * `u=` (the encoded upstream URL for a rewritten sub-resource) is now
 * AES-256-GCM encrypted (see encryptProxyTarget/decryptProxyTarget in
 * ./streamToken.ts) instead of plain reversible base64 — see
 * rewritePlaylist's own comment below for why. lib/m3u8.ts's version
 * stays plain base64 since it only ever backed the now-retired
 * app/api/video/[id]/hls-proxy/route.ts (see that file), which never
 * had this Worker's IP-binding to begin with; there's nothing left
 * calling it, so it wasn't worth touching to match.
 */

import { encryptProxyTarget, decryptProxyTarget } from './streamToken';

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

/** Thin re-exports so index.ts only needs to import from one place for
 * everything playlist-related; the actual crypto lives in
 * ./streamToken.ts since it shares the deriveKey/IV machinery the `t=`
 * token itself already uses. */
export { decryptProxyTarget };

/**
 * Same rewriting logic as lib/m3u8.ts's rewritePlaylist, with two
 * changes: an `extraQuery` param (the Next.js version never needed
 * this — its proxy route sat behind the same session cookie for every
 * request; this Worker instead authenticates each request via the `t=`
 * stream token in the query string, see index.ts, so every rewritten
 * segment/key/variant URL needs one riding along too), and `u=` is now
 * ENCRYPTED, not just encoded.
 *
 * That second change is the actual security fix here: `u=` used to be
 * plain, reversible base64 of the real upstream CDN URL — one `atob()`
 * away from anyone who copied a rewritten link, handing them Bunny's raw
 * .b-cdn.net address directly, usable forever with none of this
 * Worker's checks ever running again (see encryptProxyTarget's own
 * comment in ./streamToken.ts for how this surfaced). `u=` is now
 * AES-256-GCM encrypted with the same STREAM_TOKEN_SECRET as `t=`, so it
 * carries no more information to an outside observer than `t=` already
 * did. Requires `secret` and is now async (Web Crypto's AES-GCM has no
 * synchronous API) — `proxyBase` is e.g. "/hls/<videoId>"; `extraQuery`
 * is e.g. "t=<token>".
 */
export async function rewritePlaylist(
  text: string,
  baseUrl: string,
  proxyBase: string,
  extraQuery: string,
  secret: string
): Promise<string> {
  async function proxied(uri: string): Promise<string> {
    const target = new URL(uri, baseUrl).toString();
    const encrypted = await encryptProxyTarget(target, secret);
    return `${proxyBase}?u=${encrypted}&${extraQuery}`;
  }

  const lines = text.split('\n').map((rawLine) => rawLine.replace(/\r$/, ''));
  const rewrittenLines = await Promise.all(
    lines.map(async (line) => {
      if (line.startsWith('#EXT-X-KEY') || line.startsWith('#EXT-X-MAP')) {
        const match = line.match(/URI="([^"]+)"/);
        if (!match) return line;
        const proxiedUri = await proxied(match[1]);
        return line.replace(/URI="([^"]+)"/, `URI="${proxiedUri}"`);
      }
      if (!line || line.startsWith('#')) return line;
      return proxied(line.trim());
    })
  );
  return rewrittenLines.join('\n');
}
