import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { deviceUpdateSchema, uuidSchema } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rateLimit';
import { logAuditEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** Change status (authorize / reject / block) and/or rename an existing
 * device row. `deviceId` in the URL is the row's own id (user_devices.id),
 * not the device's persistent device_id cookie value — matches the
 * folder param name already used by the admin UI. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; deviceId: string } }
) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const rl = checkRateLimit(`admin_mutate:${auth.user.email}`, 30, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const parsedUserId = uuidSchema.safeParse(params.id);
  const parsedDeviceId = uuidSchema.safeParse(params.deviceId);
  if (!parsedUserId.success || !parsedDeviceId.success) {
    return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = deviceUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input.' }, { status: 400 });

  const adminClient = createSupabaseAdminClient();
  // When this decision changes status, stamp WHO made the call — the
  // authenticated admin, taken from their own verified session, never
  // from the request body — so the device row itself can show "Approved
  // by admin@x.com" without a trip to audit_logs. A pure rename (no
  // status in the payload) leaves these untouched.
  const patch: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.status) {
    patch.approved_by = auth.user.email;
    patch.approved_at = new Date().toISOString();
  }

  const { data, error } = await adminClient
    .from('user_devices')
    .update(patch)
    .eq('id', parsedDeviceId.data)
    .eq('user_id', parsedUserId.data)
    .select('id, status')
    .maybeSingle();

  if (error || !data) return NextResponse.json({ error: 'Could not update device.' }, { status: 400 });

  await logAuditEvent('ADMIN_ACTION', auth.user.email, parsedUserId.data, {
    action: parsed.data.status ? `DEVICE_${parsed.data.status.toUpperCase()}` : 'DEVICE_RENAMED',
    device_id: parsedDeviceId.data,
  });

  return NextResponse.json({ device: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; deviceId: string } }
) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const parsedUserId = uuidSchema.safeParse(params.id);
  const parsedDeviceId = uuidSchema.safeParse(params.deviceId);
  if (!parsedUserId.success || !parsedDeviceId.success) {
    return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });
  }

  const adminClient = createSupabaseAdminClient();
  const { error } = await adminClient
    .from('user_devices')
    .delete()
    .eq('id', parsedDeviceId.data)
    .eq('user_id', parsedUserId.data);

  if (error) return NextResponse.json({ error: 'Could not remove device.' }, { status: 400 });

  await logAuditEvent('ADMIN_ACTION', auth.user.email, parsedUserId.data, {
    action: 'DEVICE_DECISION_CLEARED',
    device_id: parsedDeviceId.data,
  });

  return NextResponse.json({ ok: true });
}
