import { NextResponse, type NextRequest } from 'next/server';
import { requireAuthorized } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rateLimit';
import { logAuditEvent } from '@/lib/audit';
import { bunnyDownloadConfigured, getAvailableResolutions, buildDownloadUrl } from '@/lib/bunny';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

/**
 * Same authorization gate as /api/video/[id]/play (must be authenticated,
 * authorized, and the video's board must be published) — repeated here
 * rather than shared, because a download link is a bigger leak surface
 * than a gated iframe embed (it works outside our app entirely once
 * issued), so this route deliberately re-checks from scratch rather than
 * trusting anything about how the caller got here.
 */
async function authorizeAndLoadVideo(videoId: string, email: string) {
  const adminClient = createSupabaseAdminClient();
  const { data: video } = await adminClient
    .from('videos')
    .select('id, provider, source_ref, board:board_id(id, published)')
    .eq('id', videoId)
    .maybeSingle();

  const board = video?.board as unknown as { id: string; published: boolean } | null;
  if (!video || !board || !board.published || video.provider !== 'bunny') {
    await logAuditEvent('VIDEO_ACCESS_DENIED', email, videoId, { reason: 'download_denied' });
    return null;
  }

  const [libraryId, bunnyVideoId] = video.source_ref.split('/');
  if (!libraryId || !bunnyVideoId) return null;

  return { libraryId, bunnyVideoId };
}

/** Lists which resolutions actually exist for this video, so the frontend
 * never offers a resolution that would 404. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuthorized();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  if (!bunnyDownloadConfigured()) {
    return NextResponse.json({ error: 'Downloads are not configured yet.' }, { status: 503 });
  }

  const parsedId = uuidSchema.safeParse(params.id);
  if (!parsedId.success) return NextResponse.json({ error: 'Access denied.' }, { status: 404 });

  const rl = checkRateLimit(`video_download_list:${auth.user.email}`, 20, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const resolved = await authorizeAndLoadVideo(parsedId.data, auth.user.email);
  if (!resolved) return NextResponse.json({ error: 'Access denied.' }, { status: 404 });

  const resolutions = await getAvailableResolutions(resolved.libraryId, resolved.bunnyVideoId);
  return NextResponse.json({ resolutions });
}

const downloadRequestSchema = z.object({
  resolution: z.string().trim().regex(/^\d{3,4}p$/, 'Invalid resolution.'),
});

/** Issues one short-lived signed download URL for exactly the requested,
 * already-verified-available resolution. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuthorized();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  if (!bunnyDownloadConfigured()) {
    return NextResponse.json({ error: 'Downloads are not configured yet.' }, { status: 503 });
  }

  const parsedId = uuidSchema.safeParse(params.id);
  if (!parsedId.success) return NextResponse.json({ error: 'Access denied.' }, { status: 404 });

  // Tighter limit than GET — this is what actually mints a working link.
  const rl = checkRateLimit(`video_download:${auth.user.email}`, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many download requests. Slow down.' }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsedBody = downloadRequestSchema.safeParse(body);
  if (!parsedBody.success) return NextResponse.json({ error: 'Invalid input.' }, { status: 400 });

  const resolved = await authorizeAndLoadVideo(parsedId.data, auth.user.email);
  if (!resolved) return NextResponse.json({ error: 'Access denied.' }, { status: 404 });

  // Re-verify the requested resolution is actually one that exists for
  // THIS video — never trust the resolution string from the client
  // beyond format-validation above.
  const available = await getAvailableResolutions(resolved.libraryId, resolved.bunnyVideoId);
  if (!available.includes(parsedBody.data.resolution)) {
    return NextResponse.json({ error: 'That resolution is not available.' }, { status: 400 });
  }

  const url = buildDownloadUrl(resolved.bunnyVideoId, parsedBody.data.resolution);

  await logAuditEvent('VIDEO_ACCESS_GRANTED', auth.user.email, parsedId.data, {
    action: 'DOWNLOAD',
    resolution: parsedBody.data.resolution,
  });

  return NextResponse.json({ url });
}
