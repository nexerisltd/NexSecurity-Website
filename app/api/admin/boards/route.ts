import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { boardSchema } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rateLimit';
import { logAuditEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('boards')
    .select('id, title, description, thumbnail_url, parent_id, sort_order, published, destination_page_id, created_at')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  return NextResponse.json({ boards: data });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const rl = checkRateLimit(`admin_mutate:${auth.user.email}`, 30, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const body = await request.json().catch(() => null);
  const parsed = boardSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input.' }, { status: 400 });

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('boards')
    .insert(parsed.data)
    .select('id, title')
    .single();

  if (error) return NextResponse.json({ error: 'Could not create board.' }, { status: 400 });

  await logAuditEvent('BOARD_CREATED', auth.user.email, data.id, { title: data.title });
  return NextResponse.json({ board: data }, { status: 201 });
}
