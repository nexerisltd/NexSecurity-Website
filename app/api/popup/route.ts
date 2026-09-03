import { NextResponse } from 'next/server';
import { requireAuthorized } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/**
 * "Should this user see the announcement right now?" — checked once per
 * page load by components/SitePopup.tsx. A user is due for it when
 * either: they've never seen the CURRENT version (site_popup_settings
 * .version), or they have but interval_hours have passed since
 * last_shown_at. Everything else (disabled, empty content, not due yet)
 * returns { popup: null } and the client shows nothing.
 */
export async function GET() {
  const auth = await requireAuthorized();
  if (!auth.ok) return NextResponse.json({ popup: null });

  const rl = checkRateLimit(`popup_check:${auth.user.email}`, 30, 60_000);
  if (!rl.allowed) return NextResponse.json({ popup: null });

  const adminClient = createSupabaseAdminClient();
  const { data: settings } = await adminClient.from('site_popup_settings').select('*').eq('id', 1).maybeSingle();

  if (!settings || !settings.enabled || (!settings.title && !settings.message)) {
    return NextResponse.json({ popup: null });
  }

  const { data: view } = await adminClient
    .from('user_popup_views')
    .select('version_seen, last_shown_at')
    .eq('user_email', auth.user.email.toLowerCase())
    .maybeSingle();

  const dueForNewVersion = !view || view.version_seen !== settings.version;
  const intervalMs = settings.interval_hours * 60 * 60 * 1000;
  const dueByInterval = view ? Date.now() - new Date(view.last_shown_at).getTime() >= intervalMs : true;

  if (!dueForNewVersion && !dueByInterval) {
    return NextResponse.json({ popup: null });
  }

  return NextResponse.json({
    popup: {
      title: settings.title,
      message: settings.message,
      button_label: settings.button_label,
      button_url: settings.button_url,
    },
  });
}

/** Called once the popup has actually been shown — records this user as
 * caught up on the current version, resetting their interval clock. */
export async function POST() {
  const auth = await requireAuthorized();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const rl = checkRateLimit(`popup_ack:${auth.user.email}`, 30, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const adminClient = createSupabaseAdminClient();
  const { data: settings } = await adminClient.from('site_popup_settings').select('version').eq('id', 1).maybeSingle();
  if (!settings) return NextResponse.json({ ok: true });

  await adminClient.from('user_popup_views').upsert(
    {
      user_email: auth.user.email.toLowerCase(),
      version_seen: settings.version,
      last_shown_at: new Date().toISOString(),
    },
    { onConflict: 'user_email' }
  );

  return NextResponse.json({ ok: true });
}
