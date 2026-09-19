import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { blockUserSchema, uuidSchema } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rateLimit';
import { logAuditEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const DEFAULT_MANUAL_BLOCK_MINUTES = 60 * 24; // 24h, same default as the auto-block path

/**
 * Manual admin block — separate from `status: 'DISABLED'` on purpose
 * (see supabase/migrations/0017_temp_block.sql): this is meant to expire
 * on its own, and is the same mechanism
 * app/api/security/incident/route.ts uses automatically when an account
 * has auto_block_on_incident on, so a device/heartbeat check
 * (lib/auth.ts's getAuth()) only ever has ONE "is this account currently
 * blocked" condition to evaluate regardless of how the block was set.
 *
 *   POST /api/admin/users/[id]/block   { minutes?, reason? }
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const rl = checkRateLimit(`admin_mutate:${auth.user.email}`, 30, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const parsedId = uuidSchema.safeParse(params.id);
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const parsed = blockUserSchema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input.' }, { status: 400 });

  const supabase = createSupabaseServerClient();
  const { data: target } = await supabase
    .from('authorized_users')
    .select('id, email, role')
    .eq('id', parsedId.data)
    .maybeSingle();

  if (!target) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  if (target.email.toLowerCase() === auth.user.email.toLowerCase()) {
    return NextResponse.json({ error: "You can't block your own account." }, { status: 400 });
  }
  if (target.role === 'ADMIN') {
    return NextResponse.json({ error: 'Admin accounts cannot be blocked.' }, { status: 400 });
  }

  const minutes = parsed.data.minutes ?? DEFAULT_MANUAL_BLOCK_MINUTES;
  const blockedUntil = new Date(Date.now() + minutes * 60_000).toISOString();
  const blockReason = parsed.data.reason?.trim() || `Manually blocked by ${auth.user.email}`;

  const { data: updated, error } = await supabase
    .from('authorized_users')
    .update({ blocked_until: blockedUntil, block_reason: blockReason, updated_at: new Date().toISOString() })
    .eq('id', parsedId.data)
    .select('id, blocked_until, block_reason')
    .single();

  if (error) return NextResponse.json({ error: 'Could not block user.' }, { status: 400 });

  await logAuditEvent('USER_MANUALLY_BLOCKED', auth.user.email, target.email, {
    minutes,
    blocked_until: blockedUntil,
    reason: blockReason,
  });

  return NextResponse.json({ user: updated });
}

/**
 * Lifts a block early — manual or auto, doesn't matter which, since both
 * just set the same blocked_until/block_reason columns. Does NOT touch
 * auto_block_on_incident, so a future incident on this same account will
 * still auto-block again unless the admin also turns that off separately
 * (PATCH /api/admin/users/[id] with auto_block_on_incident: false).
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const parsedId = uuidSchema.safeParse(params.id);
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });

  const supabase = createSupabaseServerClient();
  const { data: target } = await supabase
    .from('authorized_users')
    .select('id, email')
    .eq('id', parsedId.data)
    .maybeSingle();

  if (!target) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const { error } = await supabase
    .from('authorized_users')
    .update({ blocked_until: null, block_reason: null, updated_at: new Date().toISOString() })
    .eq('id', parsedId.data);

  if (error) return NextResponse.json({ error: 'Could not unblock user.' }, { status: 400 });

  await logAuditEvent('USER_UNBLOCKED', auth.user.email, target.email);
  return NextResponse.json({ ok: true });
}
