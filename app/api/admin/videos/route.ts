import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { videoSchema } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rateLimit';
import { logAuditEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';

// This uses the admin client deliberately: `videos` has no SELECT policy
// for anyone (see supabase/schema.sql), by design, so even an admin's
// normal RLS-scoped session client can't read it - only this
// service-role-backed, requireAdmin()-gated route can.
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const adminClient = createSupabaseAdminClient();
  const { data, error } = await adminClient
    .from('videos')
    .select(
      'id, title, description, thumbnail_url, provider, source_ref, board_id, board:board_id(id, title), created_at, video_resources(id, title, url, sort_order)'
    )
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  return NextResponse.json({ videos: data });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const rl = checkRateLimit(`admin_mutate:${auth.user.email}`, 30, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const body = await request.json().catch(() => null);
  const parsed = videoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input.' }, { status: 400 });
  }

  const adminClient = createSupabaseAdminClient();

  // One video per board (unique constraint on board_id) - fail clearly
  // instead of a confusing DB error if a board already has one.
  const { data: existing } = await adminClient
    .from('videos')
    .select('id')
    .eq('board_id', parsed.data.board_id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: 'This board already has a video. Edit or remove it first.' },
      { status: 400 }
    );
  }

  const { data, error } = await adminClient
    .from('videos')
    .insert(parsed.data)
    .select('id, title')
    .single();

  if (error) return NextResponse.json({ error: 'Could not create video.' }, { status: 400 });

  await logAuditEvent('ADMIN_ACTION', auth.user.email, data.id, {
    action: 'VIDEO_CREATED',
    title: data.title,
  });

  return NextResponse.json({ video: data }, { status: 201 });
}
