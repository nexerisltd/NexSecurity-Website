import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { reviewStatusUpdateSchema } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rateLimit';
import { logAuditEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** An admin's decision on ONE previously-recorded security incident —
 * `id` here is the audit_logs row's own bigint id, not a user/device id.
 * This never re-writes the original incident row's event_type/metadata,
 * only the review_status/reviewed_by/reviewed_at columns added
 * specifically for this (see supabase/migrations/0015_security_incidents.sql)
 * — the original recorded facts stay exactly as reported. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const rl = checkRateLimit(`admin_mutate:${auth.user.email}`, 30, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const incidentId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(incidentId)) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const parsed = reviewStatusUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input.' }, { status: 400 });

  const adminClient = createSupabaseAdminClient();
  const { data, error } = await adminClient
    .from('audit_logs')
    .update({
      review_status: parsed.data.review_status,
      reviewed_by: auth.user.email,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', incidentId)
    .in('event_type', ['DEVTOOLS_DETECTED', 'SUSPICIOUS_SECURITY_EVENT'])
    .select('id, review_status')
    .maybeSingle();

  if (error || !data) return NextResponse.json({ error: 'Could not update incident.' }, { status: 400 });

  await logAuditEvent('ADMIN_ACTION', auth.user.email, String(incidentId), {
    action: 'SECURITY_INCIDENT_REVIEWED',
    review_status: parsed.data.review_status,
  });

  return NextResponse.json({ incident: data });
}
