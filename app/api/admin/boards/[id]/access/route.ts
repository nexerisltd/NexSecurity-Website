import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rateLimit';
import { logAuditEvent } from '@/lib/audit';
import { uuidSchema } from '@/lib/validation';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const grantListSchema = z.object({
  emails: z.array(z.string().trim().email()).max(500),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const parsedId = uuidSchema.safeParse(params.id);
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('board_user_access')
    .select('user_email')
    .eq('board_id', parsedId.data);

  if (error) return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  return NextResponse.json({ emails: (data ?? []).map((r) => r.user_email) });
}

/**
 * Replaces the FULL grant list for this board in one call — the admin
 * UI sends the complete set of emails that should have access (a
 * multi-select save, not incremental add/remove), so this deletes
 * anything no longer in the list and inserts anything new. Simpler and
 * less error-prone than separate add/remove endpoints for a small
 * (15-25 user scale) admin panel.
 */
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const rl = checkRateLimit(`admin_mutate:${auth.user.email}`, 30, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const parsedId = uuidSchema.safeParse(params.id);
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });
  const boardId = parsedId.data;

  const body = await request.json().catch(() => null);
  const parsed = grantListSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input.' }, { status: 400 });

  const supabase = createSupabaseServerClient();

  const { error: deleteError } = await supabase.from('board_user_access').delete().eq('board_id', boardId);
  if (deleteError) return NextResponse.json({ error: 'Could not update access list.' }, { status: 500 });

  const emails = Array.from(new Set(parsed.data.emails.map((e) => e.toLowerCase())));
  if (emails.length > 0) {
    const { error: insertError } = await supabase
      .from('board_user_access')
      .insert(emails.map((user_email) => ({ board_id: boardId, user_email })));
    if (insertError) return NextResponse.json({ error: 'Could not update access list.' }, { status: 500 });
  }

  await logAuditEvent('BOARD_ACCESS_UPDATED', auth.user.email, boardId, { granted_count: emails.length });
  return NextResponse.json({ ok: true, emails });
}
