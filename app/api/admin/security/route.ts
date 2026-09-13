import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** Every recorded security incident (DevTools detected / suspicious
 * event — see app/api/security/incident/route.ts), newest first. Reuses
 * audit_logs directly rather than a separate table — see
 * supabase/migrations/0015_security_incidents.sql for the review_status
 * columns added specifically for this. Admin-only, same guard every
 * other /api/admin/* route uses. */
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const adminClient = createSupabaseAdminClient();
  const { data, error } = await adminClient
    .from('audit_logs')
    .select('id, event_type, actor_email, target, metadata, review_status, reviewed_by, reviewed_at, created_at')
    .in('event_type', ['DEVTOOLS_DETECTED', 'SUSPICIOUS_SECURITY_EVENT'])
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: 'Could not load incidents.' }, { status: 500 });

  return NextResponse.json({ incidents: data });
}
