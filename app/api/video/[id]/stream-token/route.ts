import { NextResponse, type NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { requireAuthorized } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rateLimit';
import { logAuditEvent } from '@/lib/audit';
import { canAccessBoard } from '@/lib/boardAccess';
import { createStreamToken } from '@/lib/streamToken';

export const dynamic = 'force-dynamic';

// Short enough that a leaked/copied `t=` value (devtools Network tab,
// browser history, a shared screen) is worthless within a couple of
// minutes; long enough that VideoPlayer.tsx's refresh loop (see
// STREAM_TOKEN_REFRESH_MS there) has comfortable headroom to fetch the
// next one before this one expires, even on a slow/flaky connection.
const TOKEN_TTL_SECONDS = 75;

/**
 * Mints a short-lived, ENCRYPTED token the Cloudflare Worker
 * (stream.<domain>, see worker/src/index.ts) uses to serve HLS
 * playlists/segments for the 'm3u8' provider without the Worker ever
 * calling Supabase itself. This route is where the real authorization
 * decision still lives — the same checks
 * app/api/video/[id]/hls-proxy/route.ts used to make on every single
 * segment request — it now just runs once every ~45s (see
 * VideoPlayer.tsx's refresh loop) instead of on every one of the dozens
 * of segment requests one playlist generates.
 *
 *   POST /api/video/[id]/stream-token
 *
 * Called directly by the browser (components/VideoPlayer.tsx) — this is
 * the client's only way to get a token, same as /play was always the
 * client's only way to get a playable URL for the other providers.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuthorized();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const parsedId = uuidSchema.safeParse(params.id);
  if (!parsedId.success) return NextResponse.json({ error: 'Access denied.' }, { status: 404 });
  const videoId = parsedId.data;

  // Called roughly once every ~45s per active viewer (see
  // STREAM_TOKEN_REFRESH_MS in VideoPlayer.tsx) — nowhere near
  // hls-proxy's old per-segment volume, so this uses /play's tighter
  // 20/min rather than hls-proxy's looser 240/min.
  const rl = checkRateLimit(`stream_token:${auth.user.email}`, 20, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const adminClient = createSupabaseAdminClient();
  const { data: video } = await adminClient
    .from('videos')
    .select('id, provider, source_ref, referer_header, board:board_id(id, published)')
    .eq('id', videoId)
    .maybeSingle();

  const board = video?.board as unknown as { id: string; published: boolean } | null;

  // Same real gate as hls-proxy used to be: authenticated + authorized
  // (above) + the video exists + is actually 'm3u8' + its board is
  // published.
  if (!video || !board || !board.published || video.provider !== 'm3u8') {
    await logAuditEvent('VIDEO_ACCESS_DENIED', auth.user.email, videoId, { reason: 'stream_token_denied' });
    return NextResponse.json({ error: 'Access denied.' }, { status: 404 });
  }

  if (!(await canAccessBoard(adminClient, auth.user.email, board.id, auth.user.role === 'ADMIN'))) {
    await logAuditEvent('VIDEO_ACCESS_DENIED', auth.user.email, videoId, { reason: 'board_restricted' });
    return NextResponse.json({ error: 'Access denied.' }, { status: 404 });
  }

  // Never the user's raw email — the Worker only uses this for its own
  // KV rate-limit bucket key (see worker/src/index.ts), and it ends up
  // (encrypted, alongside everything else) in a browser-visible URL, so
  // it gets the same "don't put real PII where it doesn't need to be"
  // treatment as the rest of this payload.
  const uid = createHash('sha256').update(auth.user.email.toLowerCase()).digest('hex').slice(0, 24);

  const token = createStreamToken({
    vid: videoId,
    uid,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
    sr: video.source_ref as string,
    rh: (video.referer_header as string | null) ?? null,
  });

  return NextResponse.json({ token, expiresIn: TOKEN_TTL_SECONDS });
}
