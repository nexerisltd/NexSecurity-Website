import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { boardUpdateSchema, uuidSchema } from '@/lib/validation';
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
  const parsed = boardUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input.' }, { status: 400 });

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('boards')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', parsedId.data)
    .select('id, title')
    .maybeSingle();

  if (error || !data) return NextResponse.json({ error: 'Could not update board.' }, { status: 400 });

  await logAuditEvent('BOARD_UPDATED', auth.user.email, data.id);
  return NextResponse.json({ board: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const parsedId = uuidSchema.safeParse(params.id);
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from('boards').delete().eq('id', parsedId.data);
  if (error) return NextResponse.json({ error: 'Could not delete board.' }, { status: 400 });

  await logAuditEvent('BOARD_DELETED', auth.user.email, parsedId.data);
  return NextResponse.json({ ok: true });
}
