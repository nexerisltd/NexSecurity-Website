import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { popupSettingsUpdateSchema } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rateLimit';
import { logAuditEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const adminClient = createSupabaseAdminClient();
  const { data, error } = await adminClient.from('site_popup_settings').select('*').eq('id', 1).maybeSingle();
  if (error) return NextResponse.json({ error: `Could not load popup settings. (${error.message})` }, { status: 400 });

  return NextResponse.json({ settings: data });
}

/**
 * Every save bumps `version` — see supabase/migrations/0006 — which
 * immediately resets EVERY user's "have I seen this?" clock, regardless
 * of when they last saw the old one. That's deliberate: an admin editing
 * the announcement almost always wants it to reach everyone again right
 * away, not have half the audience still sitting on the stale version
 * for up to interval_hours more.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const rl = checkRateLimit(`admin_mutate:${auth.user.email}`, 30, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const body = await request.json().catch(() => null);
  const parsed = popupSettingsUpdateSchema.safeParse(body);
  if (!parsed.success) {
    // Admin-only route, so it's safe (and much more useful than a bare
    // "Invalid input") to surface exactly which field tripped validation
    // — e.g. a Button link that isn't a full https:// URL — instead of
    // making the admin guess.
    const detail = parsed.error.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join('; ');
    return NextResponse.json({ error: `Invalid input — ${detail}` }, { status: 400 });
  }

  const adminClient = createSupabaseAdminClient();
  const { data: current } = await adminClient.from('site_popup_settings').select('version').eq('id', 1).maybeSingle();
  const nextVersion = (current?.version ?? 0) + 1;

  const { data, error } = await adminClient
    .from('site_popup_settings')
    .update({ ...parsed.data, version: nextVersion, updated_at: new Date().toISOString() })
    .eq('id', 1)
    .select('*')
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json(
      { error: `Could not save popup settings.${error ? ` (${error.message})` : ''}` },
      { status: 400 }
    );
  }

  await logAuditEvent('ADMIN_ACTION', auth.user.email, undefined, { action: 'POPUP_SETTINGS_UPDATED', version: nextVersion });
  return NextResponse.json({ settings: data });
}
