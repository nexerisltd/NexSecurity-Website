import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation';
import { logAuditEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';

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

  if (error) return NextResponse.json({ error: 'Could not revoke device.' }, { status: 400 });

  await logAuditEvent('ADMIN_ACTION', auth.user.email, parsedUserId.data, {
    action: 'DEVICE_REVOKED',
    device_id: parsedDeviceId.data,
  });

  return NextResponse.json({ ok: true });
}
