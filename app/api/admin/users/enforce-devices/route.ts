import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rateLimit';
import { logAuditEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * Turns restrict_devices on for every currently ACTIVE account in one
 * shot, instead of an admin doing it one user at a time from the Devices
 * page. From the moment this runs, EVERY account needs an admin-approved
 * device to reach any protected page — including anyone with an
 * already-open tab and a still-valid Supabase session, since the device
 * check in lib/auth.ts's getAuth() runs on every request, not just at
 * sign-in. That's deliberately stronger than a real "force sign out"
 * would be: a Supabase session can otherwise stay valid up to its token
 * expiry regardless of anything an admin does here, but this blocks
 * instantly regardless of token validity.
 *
 * The very next request each user makes lands them on /login with a
 * "device not approved" message, and plants a 'pending' row in
 * user_devices for their browser (see upsertDeviceAndGetStatus in
 * lib/auth.ts) — exactly the row this endpoint's caller then approves
 * from app/admin/users/[id]/page.tsx.
 */
export async function POST() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const rl = checkRateLimit(`admin_mutate:${auth.user.email}`, 10, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const adminClient = createSupabaseAdminClient();
  const { data, error } = await adminClient
    .from('authorized_users')
    .update({ restrict_devices: true })
    .eq('status', 'ACTIVE')
    .eq('restrict_devices', false)
    .select('id');

  if (error) return NextResponse.json({ error: 'Could not update users.' }, { status: 400 });

  const updatedCount = data?.length ?? 0;

  await logAuditEvent('ADMIN_ACTION', auth.user.email, 'ALL_USERS', {
    action: 'DEVICE_RESTRICTION_ENFORCED_FOR_ALL',
    updated_count: updatedCount,
  });

  return NextResponse.json({ updated: updatedCount });
}
