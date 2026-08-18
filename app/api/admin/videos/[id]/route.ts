import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { videoUpdateSchema, uuidSchema } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rateLimit';
import { logAuditEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const rl = checkRateLimit(`admin_mutate:${auth.user.email}`, 30, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const parsedId = uuidSchema.safeParse(params.id);
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const parsed = videoUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input.' }, { status: 400 });

  const adminClient = createSupabaseAdminClient();
  const { data, error } = await adminClient
    .from('videos')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', parsedId.data)
    .select('id, title')
    .maybeSingle();

  if (error || !data) return NextResponse.json({ error: 'Could not update video.' }, { status: 400 });

  await logAuditEvent('ADMIN_ACTION', auth.user.email, data.id, { action: 'VIDEO_UPDATED' });
  return NextResponse.json({ video: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const parsedId = uuidSchema.safeParse(params.id);
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });

  const adminClient = createSupabaseAdminClient();
  const { error } = await adminClient.from('videos').delete().eq('id', parsedId.data);
  if (error) return NextResponse.json({ error: 'Could not delete video.' }, { status: 400 });

  await logAuditEvent('ADMIN_ACTION', auth.user.email, parsedId.data, { action: 'VIDEO_DELETED' });
  return NextResponse.json({ ok: true });
}
