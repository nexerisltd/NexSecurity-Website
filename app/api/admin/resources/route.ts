import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { videoResourceSchema } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rateLimit';
import { logAuditEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const rl = checkRateLimit(`admin_mutate:${auth.user.email}`, 30, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const body = await request.json().catch(() => null);
  const parsed = videoResourceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input.' }, { status: 400 });
  }

  const adminClient = createSupabaseAdminClient();
  const { data, error } = await adminClient
    .from('video_resources')
    .insert(parsed.data)
    .select('id, title, url, sort_order')
    .single();

  if (error) return NextResponse.json({ error: 'Could not add resource.' }, { status: 400 });

  await logAuditEvent('ADMIN_ACTION', auth.user.email, data.id, {
    action: 'VIDEO_RESOURCE_ADDED',
    title: data.title,
  });

  return NextResponse.json({ resource: data }, { status: 201 });
}
