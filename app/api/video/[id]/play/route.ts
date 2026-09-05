import { NextResponse, type NextRequest } from 'next/server';
import { requireAuthorized } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rateLimit';
import { logAuditEvent } from '@/lib/audit';
import { buildBunnyEmbedUrl } from '@/lib/bunny';
import { buildYoutubeEmbedUrl } from '@/lib/youtube';
import { canAccessBoard } from '@/lib/boardAccess';

export const dynamic = 'force-dynamic';

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

  // Rate limiting stays — this endpoint is still worth protecting from
  // being hammered, independent of the URL itself being unsigned now.
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

  // This is the real gate: authenticated + authorized (checked above) +
  // the video exists + its board is published. Nothing below this line
  // runs unless all of that already passed.
  if (!video || !board || !board.published) {
    await logAuditEvent('VIDEO_ACCESS_DENIED', auth.user.email, videoId);
    return NextResponse.json({ error: 'Access denied.' }, { status: 404 });
  }

  // "Restricted" board visibility — same cascading ancestor-chain check
  // as the /learn pages. This route is the actual source of the playable
  // URL, so it's the check that matters most: a locked-out user can't
  // get a working embed just by knowing/guessing a video id, even if
  // they never render the board or video page at all.
  if (!(await canAccessBoard(adminClient, auth.user.email, board.id, auth.user.role === 'ADMIN'))) {
    await logAuditEvent('VIDEO_ACCESS_DENIED', auth.user.email, videoId, { reason: 'board_restricted' });
    return NextResponse.json({ error: 'Access denied.' }, { status: 404 });
  }

  if (
    video.provider !== 'bunny' &&
    video.provider !== 'youtube' &&
    video.provider !== 'mp4' &&
    video.provider !== 'm3u8'
  ) {
    await logAuditEvent('VIDEO_ACCESS_DENIED', auth.user.email, videoId, {
      reason: 'unsupported_provider',
    });
    return NextResponse.json({ error: 'This video is not currently playable.' }, { status: 500 });
  }

  let url: string;
  if (video.provider === 'youtube') {
    // source_ref is just the bare YouTube video id here (see the
    // parsing helper in app/admin/videos/page.tsx).
    url = buildYoutubeEmbedUrl(video.source_ref);
  } else if (video.provider === 'mp4') {
    // source_ref is the direct file URL itself, already validated as an
    // https URL at write time (see videoSchema in lib/validation.ts).
    // Nothing to build — it's played as-is by a native <video> element,
    // never through an <iframe>, so the source's own page/scripts (ads,
    // redirects, etc.) never get a chance to run.
    url = video.source_ref;
  } else if (video.provider === 'm3u8') {
    // Never the raw source_ref (the actual CDN playlist URL) — the
    // client only ever gets this app's own hls-proxy endpoint, which is
    // what actually attaches the Referer header this provider exists
    // for. See app/api/video/[id]/hls-proxy/route.ts.
    url = `/api/video/${videoId}/hls-proxy`;
  } else {
    const [libraryId, bunnyVideoId] = video.source_ref.split('/');
    if (!libraryId || !bunnyVideoId) {
      await logAuditEvent('VIDEO_ACCESS_DENIED', auth.user.email, videoId, {
        reason: 'malformed_source_ref',
      });
      return NextResponse.json({ error: 'This video is not currently playable.' }, { status: 500 });
    }
    url = buildBunnyEmbedUrl(libraryId, bunnyVideoId);
  }

  await logAuditEvent('VIDEO_ACCESS_GRANTED', auth.user.email, videoId);

  // "Resume playback" — best-effort, never blocks/fails the response if
  // this lookup errors for any reason. Only meaningful on the very first
  // load; VideoPlayer.tsx's periodic heartbeat re-check also hits this
  // route but deliberately ignores this field so an already-playing
  // video is never re-seeked mid-session.
  let resumeSeconds: number | null = null;
  const { data: progress } = await adminClient
    .from('video_progress')
    .select('position_seconds')
    .eq('user_email', auth.user.email)
    .eq('video_id', videoId)
    .maybeSingle();
  if (progress?.position_seconds && progress.position_seconds > 5) {
    resumeSeconds = progress.position_seconds;
  }

  return NextResponse.json({ url, provider: video.provider, resumeSeconds });
}
