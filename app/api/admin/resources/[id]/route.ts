import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation';
import { logAuditEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const parsedId = uuidSchema.safeParse(params.id);
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });

  const adminClient = createSupabaseAdminClient();
  const { error } = await adminClient.from('video_resources').delete().eq('id', parsedId.data);
  if (error) return NextResponse.json({ error: 'Could not remove resource.' }, { status: 400 });

  await logAuditEvent('ADMIN_ACTION', auth.user.email, parsedId.data, {
    action: 'VIDEO_RESOURCE_REMOVED',
  });

  return NextResponse.json({ ok: true });
}
