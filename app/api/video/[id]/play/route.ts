import { NextResponse, type NextRequest } from 'next/server';
import { requireAuthorized } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rateLimit';
import { logAuditEvent } from '@/lib/audit';
import { buildBunnyEmbedUrl } from '@/lib/bunny';
import { buildYoutubeEmbedUrl } from '@/lib/youtube';

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

  if (video.provider !== 'bunny' && video.provider !== 'youtube') {
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

  return NextResponse.json({ url, provider: video.provider });
}
