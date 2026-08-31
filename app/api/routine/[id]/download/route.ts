import { NextResponse, type NextRequest } from 'next/server';
import { requireAuthorized } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rateLimit';
import { canAccessBoard } from '@/lib/boardAccess';

export const dynamic = 'force-dynamic';

/**
 * Forces a real download of a routine image instead of opening it in a
 * new tab. A plain `<a href={supabaseUrl} download>` doesn't reliably
 * work here because routine_image_url points at Supabase Storage — a
 * different origin — and browsers only honor the `download` attribute
 * for same-origin (or CORS-permitting) URLs; cross-origin, most browsers
 * just navigate to it instead. Fetching it server-side and re-serving it
 * with a Content-Disposition: attachment header sidesteps that entirely,
 * same reasoning as the video download routes.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuthorized();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const parsedId = uuidSchema.safeParse(params.id);
  if (!parsedId.success) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const boardId = parsedId.data;

  const rl = checkRateLimit(`routine_download:${auth.user.email}`, 20, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const adminClient = createSupabaseAdminClient();
  const { data: board } = await adminClient
    .from('boards')
    .select('id, title, board_type, published, routine_image_url')
    .eq('id', boardId)
    .maybeSingle();

  if (!board || board.board_type !== 'routine' || !board.published || !board.routine_image_url) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  // Same cascading visibility check as every other board-scoped route.
  if (!(await canAccessBoard(adminClient, auth.user.email, board.id, auth.user.role === 'ADMIN'))) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(board.routine_image_url);
  } catch {
    return NextResponse.json({ error: 'Could not fetch the routine image.' }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: 'Could not fetch the routine image.' }, { status: 502 });
  }

  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
  const extension = contentType.includes('png')
    ? 'png'
    : contentType.includes('webp')
      ? 'webp'
      : contentType.includes('gif')
        ? 'gif'
        : 'jpg';
  // Strip anything that isn't filename-safe out of the title, so a
  // routine named e.g. "Class 9 / Section A" doesn't produce a
  // Content-Disposition header the browser mishandles.
  const safeName = board.title.replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-') || 'routine';

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${safeName}.${extension}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
