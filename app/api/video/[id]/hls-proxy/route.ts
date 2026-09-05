import { NextResponse, type NextRequest } from 'next/server';
import { requireAuthorized } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rateLimit';
import { logAuditEvent } from '@/lib/audit';
import { canAccessBoard } from '@/lib/boardAccess';
import {
  decodeProxyTarget,
  isSafeProxyTarget,
  looksLikePlaylist,
  m3u8FetchHeaders,
  rewritePlaylist,
} from '@/lib/m3u8';

export const dynamic = 'force-dynamic';
// Same reasoning as hls-download's maxDuration — segments are small so
// this is mostly headroom, not an expectation of actually needing it.
export const maxDuration = 60;

/**
 * Streams an admin-configured .m3u8 (HLS) playlist and its segments to an
 * authorized viewer, attaching the Referer header the source CDN requires
 * — a header browsers block client-side JS from setting itself (see
 * lib/m3u8.ts), so this proxy is the only place it can actually be
 * attached. The raw source URL and Referer never reach the client:
 * VideoPlayer.tsx only ever gives hls.js this route's own same-origin URL.
 *
 *   GET /api/video/[id]/hls-proxy            -> the root playlist
 *   GET /api/video/[id]/hls-proxy?u=<token>  -> a sub-resource the root
 *     (or a variant) playlist referenced — rewritten to this shape by
 *     rewritePlaylist() below, never constructed by the client itself.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuthorized();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const parsedId = uuidSchema.safeParse(params.id);
  if (!parsedId.success) return NextResponse.json({ error: 'Access denied.' }, { status: 404 });
  const videoId = parsedId.data;

  // Segments/keys/variant playlists can outnumber a page's initial /play
  // call many times over across a single class, so this is deliberately
  // looser than /play's 20/min — still enough to stop abuse without
  // breaking normal seeking/quality-switch bursts.
  const rl = checkRateLimit(`hls_proxy:${auth.user.email}`, 240, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const adminClient = createSupabaseAdminClient();
  const { data: video } = await adminClient
    .from('videos')
    .select('id, provider, source_ref, referer_header, board:board_id(id, published)')
    .eq('id', videoId)
    .maybeSingle();

  const board = video?.board as unknown as { id: string; published: boolean } | null;

  // Same real gate as /play: authenticated + authorized (above) + the
  // video exists + is actually 'm3u8' + its board is published.
  if (!video || !board || !board.published || video.provider !== 'm3u8') {
    await logAuditEvent('VIDEO_ACCESS_DENIED', auth.user.email, videoId, { reason: 'hls_proxy_denied' });
    return NextResponse.json({ error: 'Access denied.' }, { status: 404 });
  }

  if (!(await canAccessBoard(adminClient, auth.user.email, board.id, auth.user.role === 'ADMIN'))) {
    await logAuditEvent('VIDEO_ACCESS_DENIED', auth.user.email, videoId, { reason: 'board_restricted' });
    return NextResponse.json({ error: 'Access denied.' }, { status: 404 });
  }

  const token = request.nextUrl.searchParams.get('u');
  const targetUrl = token ? decodeProxyTarget(token) : (video.source_ref as string);
  if (!targetUrl) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  if (!isSafeProxyTarget(targetUrl)) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });

  const referer = (video.referer_header as string | null) ?? null;
  const upstreamHeaders = m3u8FetchHeaders(referer);
  // Byte-range playlists (#EXT-X-BYTERANGE) are rare but forwarding a
  // client Range request costs nothing and keeps those working too.
  const range = request.headers.get('range');

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(targetUrl, {
      cache: 'no-store',
      headers: range ? { ...upstreamHeaders, Range: range } : upstreamHeaders,
    });
  } catch (err) {
    console.error('[hls-proxy] upstream fetch threw', targetUrl, err);
    return NextResponse.json({ error: 'Video stream is not currently available.' }, { status: 502 });
  }

  if (!upstreamRes.ok && upstreamRes.status !== 206) {
    console.error('[hls-proxy] upstream fetch failed', upstreamRes.status, targetUrl);
    return NextResponse.json(
      { error: `Video stream is not currently available. (CDN ${upstreamRes.status})` },
      { status: 502 }
    );
  }

  const upstreamContentType = upstreamRes.headers.get('content-type') ?? '';
  const looksLikeM3u8Url = /\.m3u8($|\?)/i.test(targetUrl);

  if (looksLikeM3u8Url || upstreamContentType.includes('mpegurl')) {
    const text = await upstreamRes.text();
    if (!looksLikePlaylist(text)) {
      // Doesn't actually look like a playlist (bad URL, a CDN error page,
      // etc.) — pass it through as-is rather than pretending it rewrote
      // cleanly, so the real problem surfaces instead of a blank player.
      return new NextResponse(text, {
        status: upstreamRes.status,
        headers: { 'Content-Type': upstreamContentType || 'text/plain', 'Cache-Control': 'no-store' },
      });
    }
    const proxyBase = `/api/video/${videoId}/hls-proxy`;
    const rewritten = rewritePlaylist(text, targetUrl, proxyBase);
    return new NextResponse(rewritten, {
      status: upstreamRes.status,
      headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' },
    });
  }

  // Segment (.ts/.m4s) or AES-128 key — stream straight through without
  // buffering it fully in memory first.
  const passthroughHeaders: Record<string, string> = {
    'Content-Type': upstreamContentType || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'Accept-Ranges': 'bytes',
  };
  const contentRange = upstreamRes.headers.get('content-range');
  if (contentRange) passthroughHeaders['Content-Range'] = contentRange;

  return new NextResponse(upstreamRes.body, {
    status: upstreamRes.status,
    headers: passthroughHeaders,
  });
}
