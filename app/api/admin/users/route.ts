import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { addAuthorizedUserSchema } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rateLimit';
import { logAuditEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('authorized_users')
    .select('id, email, role, status, created_at, updated_at')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  return NextResponse.json({ users: data });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const rl = checkRateLimit(`admin_mutate:${auth.user.email}`, 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = addAuthorizedUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input.' }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('authorized_users')
    .insert({ email: parsed.data.email, role: parsed.data.role, status: 'ACTIVE' })
    .select('id, email, role, status')
    .single();

  if (error) {
    // Don't leak whether it failed because the email already exists vs.
    // some other DB error — generic message either way.
    return NextResponse.json({ error: 'Could not add user.' }, { status: 400 });
  }

  await logAuditEvent('USER_ADDED', auth.user.email, parsed.data.email, {
    role: parsed.data.role,
  });

  return NextResponse.json({ user: data }, { status: 201 });
}
