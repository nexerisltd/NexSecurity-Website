import { NextResponse, type NextRequest } from 'next/server';
import { requireAuthorized } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rateLimit';
import { logAuditEvent } from '@/lib/audit';
import { canAccessBoard } from '@/lib/boardAccess';
import { createStreamToken, hashForToken } from '@/lib/streamToken';
import { getClientIp, getDeviceId } from '@/lib/requestInfo';

export const dynamic = 'force-dynamic';

// How many of an account's own devices may be actively streaming AT THE
// SAME TIME (not "how many devices are approved to sign in" — that's
// restrict_devices/user_devices, an entirely separate, indefinite
// admin decision). Default 2 (phone + laptop is the common legitimate
// pattern) — configurable since what's "normal" varies by deployment
// (a household plan vs. a strict single-seat one). See
// active_stream_sessions below for how "actively streaming" is tracked.
function getConcurrentSessionLimit(): number {
  const raw = process.env.CONCURRENT_STREAM_LIMIT;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
}

// How long a device counts as "still actively streaming" after its last
// token refresh before it's considered to have stopped and its slot
// freed up. Must comfortably exceed STREAM_TOKEN_REFRESH_MS
// (components/VideoPlayer.tsx, ~10s) so a normal refresh cycle never
// looks like the device went idle; short enough that closing a tab or
// losing connection frees the slot again within tens of seconds, not
// minutes.
const ACTIVE_SESSION_WINDOW_SECONDS = 30;

// Short enough that a leaked/copied `t=` value (devtools Network tab,
// browser history, a shared screen) is worthless within seconds; long
// enough that VideoPlayer.tsx's refresh loop (see STREAM_TOKEN_REFRESH_MS
// there) has comfortable headroom to fetch the next one before this one
// expires, even on a slow/flaky connection. Was 75s — dropped once the
// token also got IP-bound (see the `ip` field below and
// worker/src/index.ts): TTL is now defense-in-depth on top of that check,
// not the only thing standing between a copied URL and a stranger's
// browser, so it no longer needs to carry the whole burden alone.
const TOKEN_TTL_SECONDS = 25;

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

  // Concurrent session cap (see active_stream_sessions in
  // supabase/migrations/0018_active_stream_sessions.sql and
  // getConcurrentSessionLimit() above). Admins exempt — same trusted-role
  // carve-out as isRestricted/DevToolsGuard elsewhere in this codebase;
  // an admin legitimately opens the same class from several devices
  // while reviewing content.
  //
  // Checked BEFORE upserting this device's own row — existing active
  // devices keep their slot; only a NEW device trying to join beyond the
  // cap gets turned away, so this never silently kicks a session that
  // was already playing. (A soft, DB-backed limit, not a hard atomic
  // one — two devices requesting a token in the same instant could both
  // slip through before either's upsert lands. Acceptable for what this
  // is: a deterrent against casual "share my login with 5 friends"
  // account sharing, not a security boundary the way the IP-bound token
  // itself is.)
  const deviceId = getDeviceId();
  if (auth.user.role !== 'ADMIN' && deviceId) {
    const limit = getConcurrentSessionLimit();
    const windowStart = new Date(Date.now() - ACTIVE_SESSION_WINDOW_SECONDS * 1000).toISOString();
    const { data: activeRows } = await adminClient
      .from('active_stream_sessions')
      .select('device_id')
      .eq('user_id', auth.user.id)
      .gte('last_seen_at', windowStart);

    const activeDeviceIds = new Set((activeRows ?? []).map((r) => r.device_id as string));
    if (!activeDeviceIds.has(deviceId) && activeDeviceIds.size >= limit) {
      await logAuditEvent('CONCURRENT_SESSION_LIMIT_HIT', auth.user.email, auth.user.id, {
        device_id: deviceId,
        video_id: videoId,
        active_device_count: activeDeviceIds.size,
        limit,
      });
      return NextResponse.json(
        { error: 'This account already has the maximum number of devices streaming at once.', code: 'CONCURRENT_SESSION_LIMIT' },
        { status: 409 }
      );
    }

    // Claims/refreshes this device's slot. Fire-and-forget-ish (still
    // awaited, but a failure here shouldn't block playback — see catch
    // below) since this is bookkeeping for the NEXT request's check, not
    // something this request itself depends on.
    const { error: upsertError } = await adminClient
      .from('active_stream_sessions')
      .upsert(
        { user_id: auth.user.id, device_id: deviceId, video_id: videoId, last_seen_at: new Date().toISOString() },
        { onConflict: 'user_id,device_id' }
      );
    if (upsertError) console.error('[stream-token] failed to record active session', upsertError);
  }

  // Never the user's raw email — the Worker only uses this for its own
  // KV rate-limit bucket key (see worker/src/index.ts), and it ends up
  // (encrypted, alongside everything else) in a browser-visible URL, so
  // it gets the same "don't put real PII where it doesn't need to be"
  // treatment as the rest of this payload.
  const uid = hashForToken(auth.user.email.toLowerCase());

  // IP-binds the token to whatever network THIS mint request came from
  // — getClientIp() is the same "closest hop" IP lib/auth.ts already
  // trusts for device ip_history, and hashForToken() gives the Worker
  // something to compare against without this ever carrying a raw IP
  // across the wire in a browser-visible URL. See worker/src/index.ts
  // for the matching check on every playlist/segment request.
  const ip = hashForToken(getClientIp());

  const token = createStreamToken({
    vid: videoId,
    uid,
    ip,
    aid: auth.user.id,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
    sr: video.source_ref as string,
    rh: (video.referer_header as string | null) ?? null,
  });

  return NextResponse.json({ token, expiresIn: TOKEN_TTL_SECONDS });
}
