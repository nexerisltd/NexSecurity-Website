import { NextResponse, type NextRequest } from 'next/server';
import { requireAuthorized } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema, videoProgressSchema } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rateLimit';
import { canAccessBoard } from '@/lib/boardAccess';

export const dynamic = 'force-dynamic';

/**
 * "Resume playback" support. VideoPlayer.tsx calls this periodically
 * (every ~15s while playing) and again on pause/unload, for BOTH
 * providers (bunny + youtube) — reported directly from the client since
 * that's the only place actual playback position is known. The saved
 * value is later read back by /api/video/[id]/play so reopening a class
 * auto-seeks to where the student left off.
 *
 * Same auth + board-published gate as /play, repeated here rather than
 * shared for the same reason /download does: never trust that a caller
 * got here legitimately just because it hit this route.
 */
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

  // Generous but bounded — this fires roughly every 15s during normal
  // playback, well under this, while still stopping abuse/loops.
  const rl = checkRateLimit(`video_progress:${auth.user.email}`, 60, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const parsed = videoProgressSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid progress payload.' }, { status: 400 });
  }

  const adminClient = createSupabaseAdminClient();

  // Re-check the video is real and its board is published — same shape
  // as /play's gate — before writing anything tied to this videoId.
  const { data: video } = await adminClient
    .from('videos')
    .select('id, board:board_id(id, published)')
    .eq('id', videoId)
    .maybeSingle();
  const board = video?.board as unknown as { id: string; published: boolean } | null;
  if (!video || !board || !board.published) {
    return NextResponse.json({ error: 'Access denied.' }, { status: 404 });
  }

  // Same cascading board-visibility check as /play — a user who loses
  // access to a restricted board mid-session shouldn't keep writing
  // progress rows for videos under it.
  if (!(await canAccessBoard(adminClient, auth.user.email, board.id, auth.user.role === 'ADMIN'))) {
    return NextResponse.json({ error: 'Access denied.' }, { status: 404 });
  }

  const { error } = await adminClient.from('video_progress').upsert(
    {
      user_email: auth.user.email,
      video_id: videoId,
      position_seconds: parsed.data.position_seconds,
      duration_seconds: parsed.data.duration_seconds ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_email,video_id' }
  );

  if (error) {
    return NextResponse.json({ error: 'Could not save progress.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
