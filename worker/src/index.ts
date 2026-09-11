import { decryptStreamToken } from './streamToken';
import {
  decodeProxyTarget,
  isSafeProxyTarget,
  looksLikePlaylist,
  m3u8FetchHeaders,
  rewritePlaylist,
} from './m3u8';
import { checkRateLimit } from './rateLimit';

export interface Env {
  STREAM_TOKEN_SECRET: string;
  STREAM_RATE_LIMIT: KVNamespace;
}

// Matches hls-proxy's old 240/60s (see
// ../../app/api/video/[id]/hls-proxy/route.ts) — same per-user segment
// volume, since this Worker now serves exactly what that route used to.
const RATE_LIMIT = 240;
const RATE_LIMIT_WINDOW_SECONDS = 60;

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Streams an admin-configured .m3u8 (HLS) playlist and its segments to
 * an authorized viewer, attaching the Referer header the source CDN
 * requires — ported from ../../app/api/video/[id]/hls-proxy/route.ts,
 * which this replaces for actual byte-serving. The one thing that
 * changed: authorization here is "does this `t=` token decrypt and
 * still have time on it", not a live Supabase session check — the real
 * session/board/device checks still run in
 * ../../app/api/video/[id]/stream-token/route.ts, which is the only
 * thing that ever mints a token this Worker will accept.
 *
 *   GET /hls/:videoId?t=<streamToken>            -> the root playlist
 *   GET /hls/:videoId?u=<token>&t=<streamToken>  -> a sub-resource the
 *     root (or a variant) playlist referenced — rewritten to this shape
 *     by rewritePlaylist() below, never constructed by the client
 *     itself.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const match = url.pathname.match(/^\/hls\/([^/]+)\/?$/);
    if (!match || request.method !== 'GET') {
      return jsonError('Not found.', 404);
    }
    const videoId = match[1];

    const token = url.searchParams.get('t');
    if (!token) return jsonError('Access denied.', 401);

    const payload = await decryptStreamToken(token, env.STREAM_TOKEN_SECRET);
    if (!payload) return jsonError('Access denied.', 401);

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (payload.exp <= nowSeconds) return jsonError('Token expired.', 401);
    // Stops a token minted for video A being replayed against video B's
    // path — the encrypted payload's own `vid` must match what's
    // actually being requested.
    if (payload.vid !== videoId) return jsonError('Access denied.', 403);

    const allowed = await checkRateLimit(env.STREAM_RATE_LIMIT, payload.uid, RATE_LIMIT, RATE_LIMIT_WINDOW_SECONDS);
    if (!allowed) return jsonError('Too many requests.', 429);

    // Root playlist request (no `u`) plays the video's own source_ref,
    // embedded in the token at mint time; a rewritten sub-resource
    // request (`u=<encoded>`) plays whatever absolute URL that
    // sub-resource resolved to. Same shape as hls-proxy's `u` param.
    const uParam = url.searchParams.get('u');
    const targetUrl = uParam ? decodeProxyTarget(uParam) : payload.sr;
    if (!targetUrl) return jsonError('Bad request.', 400);
    if (!isSafeProxyTarget(targetUrl)) return jsonError('Bad request.', 400);

    const upstreamHeaders = m3u8FetchHeaders(payload.rh);
    // Byte-range playlists (#EXT-X-BYTERANGE) are rare but forwarding a
    // client Range request costs nothing and keeps those working too.
    const range = request.headers.get('range');

    let upstreamRes: Response;
    try {
      upstreamRes = await fetch(targetUrl, {
        headers: range ? { ...upstreamHeaders, Range: range } : upstreamHeaders,
        // Workers' fetch doesn't support the standard `cache` RequestInit
        // option (no browser-style HTTP cache to opt out of) — `cf.cacheTtl:
        // 0` / `cacheEverything: false` is the Cloudflare-specific
        // equivalent of the Next.js route's `cache: 'no-store'`, and it
        // matters here: without it, Cloudflare's edge cache could serve a
        // stale segment/playlist to a different viewer entirely.
        cf: { cacheTtl: 0, cacheEverything: false },
      });
    } catch (err) {
      console.error('[stream-worker] upstream fetch threw', targetUrl, err);
      return jsonError('Video stream is not currently available.', 502);
    }

    if (!upstreamRes.ok && upstreamRes.status !== 206) {
      console.error('[stream-worker] upstream fetch failed', upstreamRes.status, targetUrl);
      // A 4xx from the CDN is definitive — retrying the exact same
      // request will just fail the exact same way again. Passing that
      // real status straight through (instead of always answering 502)
      // is what lets the player's own error handling (see the hls.js
      // ERROR handler in ../../components/VideoPlayer.tsx) tell "this
      // is permanently broken" apart from "the CDN had a transient
      // blip, worth retrying".
      const status = upstreamRes.status >= 400 && upstreamRes.status < 500 ? upstreamRes.status : 502;
      return jsonError(`Video stream is not currently available. (CDN ${upstreamRes.status})`, status);
    }

    const upstreamContentType = upstreamRes.headers.get('content-type') ?? '';
    const looksLikeM3u8Url = /\.m3u8($|\?)/i.test(targetUrl);

    if (looksLikeM3u8Url || upstreamContentType.includes('mpegurl')) {
      const text = await upstreamRes.text();
      if (!looksLikePlaylist(text)) {
        // Doesn't actually look like a playlist (bad URL, a CDN error
        // page, etc.) — pass it through as-is rather than pretending it
        // rewrote cleanly, so the real problem surfaces instead of a
        // blank player.
        return new Response(text, {
          status: upstreamRes.status,
          headers: { 'Content-Type': upstreamContentType || 'text/plain', 'Cache-Control': 'no-store' },
        });
      }
      const proxyBase = `/hls/${videoId}`;
      // The token appended here is whatever was current AT REWRITE
      // TIME. VideoPlayer.tsx's xhrSetup overwrites `t=` with a freshly
      // refreshed token on every outgoing request regardless of what's
      // baked into the playlist, so a playlist rewritten minutes ago
      // still plays fine even though ITS embedded token has long since
      // expired — see that file's xhrSetup comment for the full
      // reasoning. Re-encoding here is still correct/required: it's
      // what makes a playlist usable at all for the very first request,
      // before any refresh has had a chance to run.
      const rewritten = rewritePlaylist(text, targetUrl, proxyBase, `t=${encodeURIComponent(token)}`);
      return new Response(rewritten, {
        status: upstreamRes.status,
        headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' },
      });
    }

    // Segment (.ts/.m4s) or AES-128 key — stream straight through
    // without buffering it fully in memory first.
    const passthroughHeaders: Record<string, string> = {
      'Content-Type': upstreamContentType || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Accept-Ranges': 'bytes',
    };
    const contentRange = upstreamRes.headers.get('content-range');
    if (contentRange) passthroughHeaders['Content-Range'] = contentRange;

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: passthroughHeaders,
    });
  },
};
