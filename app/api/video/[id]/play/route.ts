import { NextResponse, type NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { requireAuthorized } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rateLimit';
import { logAuditEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const BUNNY_TOKEN_TTL_SECONDS = 60 * 10; // Bunny recommends short-lived tokens; 10 min is plenty per viewing session

/**
 * Bunny Stream "Token Authentication" for embed views:
 * token = sha256(SECURITY_KEY + videoId + expires), sent as ?token=&expires=
 * on the embed URL. Pair this with "Allowed Referrers" set to your domain
 * in the Bunny dashboard (Stream Library -> Security) - the token alone
 * only proves the link hasn't expired, the referrer check is what makes a
 * copy-pasted link fail on someone else's site.
 * Docs: https://docs.bunny.net/docs/stream-embed-view-token-authentication
 */
function buildBunnyEmbedUrl(libraryId: string, videoId: string): { url: string; expiresAt: string } {
  const securityKey = process.env.BUNNY_STREAM_TOKEN_KEY;
  if (!securityKey) {
    throw new Error('BUNNY_STREAM_TOKEN_KEY is not configured on the server.');
  }

  const expires = Math.floor(Date.now() / 1000) + BUNNY_TOKEN_TTL_SECONDS;
  const token = createHash('sha256').update(`${securityKey}${videoId}${expires}`).digest('hex');

  const url = `https://iframe.mediadelivery.net/embed/${libraryId}/${videoId}?token=${token}&expires=${expires}&autoplay=false`;

  return { url, expiresAt: new Date(expires * 1000).toISOString() };
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuthorized();
  if (!auth.ok) {
    return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });
  }

  const parsedId = uuidSchema.safeParse(params.id);
  if (!parsedId.success) {
    return NextResponse.json({ error: 'Access denied.' }, { status: 404 });
  }
  const videoId = parsedId.data;

  // Rate limit playback-token issuance per user, independent of the
  // generic API rate limit — this is the endpoint most worth protecting
  // against being farmed for a stash of signed URLs to redistribute.
  const rl = checkRateLimit(`video_play:${auth.user.email}`, 20, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 });
  }

  const adminClient = createSupabaseAdminClient();

  const { data: video } = await adminClient
    .from('videos')
    .select('id, provider, source_ref, board:board_id(id, published)')
    .eq('id', videoId)
    .maybeSingle();

  const board = video?.board as unknown as { id: string; published: boolean } | null;

  if (!video || !board || !board.published) {
    await logAuditEvent('VIDEO_ACCESS_DENIED', auth.user.email, videoId);
    return NextResponse.json({ error: 'Access denied.' }, { status: 404 });
  }

  if (video.provider !== 'bunny') {
    await logAuditEvent('VIDEO_ACCESS_DENIED', auth.user.email, videoId, {
      reason: 'unsupported_provider',
    });
    return NextResponse.json({ error: 'This video is not currently playable.' }, { status: 500 });
  }

  const [libraryId, bunnyVideoId] = video.source_ref.split('/');
  if (!libraryId || !bunnyVideoId) {
    await logAuditEvent('VIDEO_ACCESS_DENIED', auth.user.email, videoId, {
      reason: 'malformed_source_ref',
    });
    return NextResponse.json({ error: 'This video is not currently playable.' }, { status: 500 });
  }

  let url: string;
  let expiresAt: string;

  try {
    const signed = buildBunnyEmbedUrl(libraryId, bunnyVideoId);
    url = signed.url;
    expiresAt = signed.expiresAt;
  } catch (err) {
    console.error('[video/play] bunny token error', err);
    await logAuditEvent('VIDEO_ACCESS_DENIED', auth.user.email, videoId, {
      reason: 'bunny_config_missing',
    });
    return NextResponse.json({ error: 'Could not start playback.' }, { status: 500 });
  }

  await adminClient.from('video_playback_tokens').insert({
    video_id: videoId,
    user_email: auth.user.email,
    expires_at: expiresAt,
  });

  await logAuditEvent('VIDEO_ACCESS_GRANTED', auth.user.email, videoId);

  return NextResponse.json({ url, expiresAt });
}
