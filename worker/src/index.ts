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

// hls.js ব্রাউজার থেকে সরাসরি এই Worker-কে (আলাদা origin/domain) call
// করে, তাই CORS header ছাড়া ব্রাউজার response-টা silently reject করে
// দেয় — token-ই এখানে আসল security gate, তাই origin খোলা রাখাটা কোনো
// অতিরিক্ত ঝুঁকি তৈরি করছে না।
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Range',
};

// Segments/keys are content-immutable once published — a given
// source_ref's byte-for-byte output never changes — so once ONE viewer
// causes this Worker to fetch a segment from Bunny, every other viewer
// of the SAME video (a whole class watching the same lecture at once is
// the normal case here, not an edge case) can be served that exact
// segment straight from Cloudflare's edge instead of each of them
// separately re-fetching it from Bunny. That shared cache is what
// actually makes playback feel instant/smooth like YouTube under real
// concurrent load — token verification below still runs on every
// single request either way, so a cache hit never skips authorization,
// it only skips the (identical, already-verified-safe) origin fetch.
const SEGMENT_CACHE_SECONDS = 24 * 60 * 60; // 1 day
// Playlists change if an admin edits source_ref/referer_header, so this
// stays short — long enough to absorb the burst of every student in a
// class opening the same lecture within the same few seconds, short
// enough that an admin edit shows up well within a minute.
const PLAYLIST_CACHE_SECONDS = 20;

function buildCacheKey(request: Request): Request {
  // `t` (the per-user stream token) is an auth credential, not part of
  // the actual content identity — two different students' tokens for
  // the same video/segment should hit the exact same cache entry, not
  // create a separate one each. Stripping it is what makes the shared
  // cache above actually shared instead of accidentally per-user.
  const keyUrl = new URL(request.url);
  keyUrl.searchParams.delete('t');
  return new Request(keyUrl.toString(), { method: 'GET' });
}

function withCorsAndNoStore(response: Response): Response {
  // Whatever TTL a cached copy carries at the EDGE (see
  // SEGMENT_CACHE_SECONDS/PLAYLIST_CACHE_SECONDS above) is irrelevant to
  // what the BROWSER itself is told — the browser should never cache
  // this response on disk, both because it's tied to a short-lived
  // token and because re-requesting is how a still-playing video keeps
  // picking up a freshly refreshed one.
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, headers });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
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
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Browser preflight (OPTIONS) request — CORS-এর নিয়ম অনুযায়ী
    // ব্রাউজার মাঝে মাঝে আসল GET-এর আগে এটা পাঠায়, জানার জন্য যে
    // cross-origin request allowed কিনা।
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

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

    // Range requests (seeking, or a player resuming mid-segment) get
    // skipped from the shared edge cache below — Cache API + partial-
    // content semantics correctly is genuinely fiddly to get right, and
    // seeks are a small minority of requests next to the sequential
    // segment-by-segment fetches normal playback makes. Those normal
    // ones are exactly what benefit from caching anyway.
    const range = request.headers.get('range');
    const cache = caches.default;
    const cacheKey = range ? null : buildCacheKey(request);

    if (cacheKey) {
      const cached = await cache.match(cacheKey);
      if (cached) return withCorsAndNoStore(cached);
    }

    // Root playlist request (no `u`) plays the video's own source_ref,
    // embedded in the token at mint time; a rewritten sub-resource
    // request (`u=<encoded>`) plays whatever absolute URL that
    // sub-resource resolved to. Same shape as hls-proxy's `u` param.
    const uParam = url.searchParams.get('u');
    const targetUrl = uParam ? decodeProxyTarget(uParam) : payload.sr;
    if (!targetUrl) return jsonError('Bad request.', 400);
    if (!isSafeProxyTarget(targetUrl)) return jsonError('Bad request.', 400);

    const upstreamHeaders = m3u8FetchHeaders(payload.rh);

    let upstreamRes: Response;
    try {
      upstreamRes = await fetch(targetUrl, {
        headers: range ? { ...upstreamHeaders, Range: range } : upstreamHeaders,
        // Workers' fetch doesn't support the standard `cache` RequestInit
        // option (no browser-style HTTP cache to opt out of) — this
        // disables CLOUDFLARE'S OWN transparent caching of the raw
        // Bunny response, which is a completely separate thing from the
        // deliberate caches.default usage above/below: that one caches
        // OUR rewritten/validated response, keyed without the token;
        // this one would cache Bunny's raw response as-is (including
        // whatever caching Bunny itself might return headers for) and
        // isn't something this Worker wants to rely on.
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
        // blank player. Never cached (it's an error condition) — still
        // needs CORS_HEADERS since it reaches the browser the exact
        // same cross-origin way every other response here does.
        return new Response(text, {
          status: upstreamRes.status,
          headers: { 'Content-Type': upstreamContentType || 'text/plain', 'Cache-Control': 'no-store', ...CORS_HEADERS },
        });
      }
      const proxyBase = `/hls/${videoId}`;
      // The token appended here is whatever was current AT REWRITE
      // TIME. VideoPlayer.tsx's xhrSetup overwrites `t=` with a freshly
      // refreshed token on every outgoing request regardless of what's
      // baked into the playlist, so a playlist rewritten minutes ago
      // still plays fine even though ITS embedded token has long since
      // expired — see that file's xhrSetup comment for the full
      // reasoning. This is ALSO exactly why caching the rewritten
      // playlist across viewers (below) is safe even though it bakes in
      // whichever one viewer's token happened to trigger the cache
      // miss: every other viewer's xhrSetup overwrites it with their
      // own token before the request actually goes out.
      const rewritten = rewritePlaylist(text, targetUrl, proxyBase, `t=${encodeURIComponent(token)}`);
      if (cacheKey) {
        ctx.waitUntil(
          cache.put(
            cacheKey,
            new Response(rewritten, {
              status: upstreamRes.status,
              headers: {
                'Content-Type': 'application/vnd.apple.mpegurl',
                'Cache-Control': `public, max-age=${PLAYLIST_CACHE_SECONDS}`,
              },
            })
          )
        );
      }
      return new Response(rewritten, {
        status: upstreamRes.status,
        headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store', ...CORS_HEADERS },
      });
    }

    // Segment (.ts/.m4s) or AES-128 key. `.tee()`s the upstream body
    // into two independent streams — one served to this viewer right
    // now, one written into the shared edge cache in the background —
    // so this still never buffers the full segment into memory (the
    // original "stream straight through" guarantee), it just streams it
    // to two destinations instead of one.
    const passthroughHeaders: Record<string, string> = {
      'Content-Type': upstreamContentType || 'application/octet-stream',
      'Accept-Ranges': 'bytes',
    };
    const contentRange = upstreamRes.headers.get('content-range');
    if (contentRange) passthroughHeaders['Content-Range'] = contentRange;

    if (cacheKey && upstreamRes.status === 200 && upstreamRes.body) {
      const [forClient, forCache] = upstreamRes.body.tee();
      ctx.waitUntil(
        cache.put(
          cacheKey,
          new Response(forCache, {
            status: upstreamRes.status,
            headers: { ...passthroughHeaders, 'Cache-Control': `public, max-age=${SEGMENT_CACHE_SECONDS}` },
          })
        )
      );
      return new Response(forClient, {
        status: upstreamRes.status,
        headers: { ...passthroughHeaders, 'Cache-Control': 'no-store', ...CORS_HEADERS },
      });
    }

    // Range (206) response, or a body-less status — never cached (see
    // the range check above), streamed straight through as before.
    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: { ...passthroughHeaders, 'Cache-Control': 'no-store', ...CORS_HEADERS },
    });
  },
};
