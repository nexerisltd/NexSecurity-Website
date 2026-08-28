import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getClientIp, getDeviceLabel, getDeviceId } from '@/lib/requestInfo';
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
 *
 * IMPORTANT self-lockout guard: the admin clicking this button is
 * themselves an ACTIVE account, on some device right now — without this
 * step they'd get blocked by their own action on their very next click,
 * with no way back into the admin panel to approve themselves. So this
 * pre-authorizes the CALLER's current device_id before flipping the
 * switch, using the same identity the click itself just proved is
 * legitimate (a valid admin session making this exact request).
 */
export async function POST() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const rl = checkRateLimit(`admin_mutate:${auth.user.email}`, 10, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const adminClient = createSupabaseAdminClient();

  const callerDeviceId = getDeviceId();
  if (callerDeviceId) {
    const nowIso = new Date().toISOString();
    const ip = getClientIp();
    const deviceLabel = getDeviceLabel();
    await adminClient.from('user_devices').upsert(
      {
        user_id: auth.user.id,
        device_id: callerDeviceId,
        ip_address: ip,
        ip_history: [{ ip, at: nowIso }],
        device_label: deviceLabel,
        status: 'authorized',
        label: 'This device (auto-approved when restriction was turned on)',
        first_seen: nowIso,
        last_seen: nowIso,
      },
      { onConflict: 'user_id,device_id', ignoreDuplicates: false }
    );
  }

  const { data, error } = await adminClient
    .from('authorized_users')
    .update({ restrict_devices: true })
    .eq('status', 'ACTIVE')
    .eq('restrict_devices', false)
    .neq('role', 'ADMIN')
    .select('id');

  if (error) return NextResponse.json({ error: 'Could not update users.' }, { status: 400 });

  const updatedCount = data?.length ?? 0;

  await logAuditEvent('ADMIN_ACTION', auth.user.email, 'ALL_USERS', {
    action: 'DEVICE_RESTRICTION_ENFORCED_FOR_ALL',
    updated_count: updatedCount,
    caller_device_auto_authorized: Boolean(callerDeviceId),
  });

  return NextResponse.json({ updated: updatedCount, selfAuthorized: Boolean(callerDeviceId) });
}
