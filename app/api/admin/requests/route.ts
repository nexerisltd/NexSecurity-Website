import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/** How many pending rows to return. This feeds a notification bell and a
 * review list for humans, not a bulk export — if an account genuinely
 * has more pending requests than this, something else is wrong (e.g. a
 * device_id that isn't sticking, generating a fresh row every visit) and
 * is worth an admin noticing on its own rather than this endpoint trying
 * to page through it. */
const MAX_RESULTS = 200;

// user_devices and authorized_users both have no SELECT policy for
// anyone but admins (see supabase/schema.sql) — read through the admin
// client, consistent with every other admin-only listing in this app.
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  // Generous but bounded — this is polled every ~15s per open admin tab
  // (see components/TopNav.tsx and app/admin/requests/page.tsx), so a
  // single admin with a couple of tabs open easily makes several calls a
  // minute; this only needs to catch something actually wrong (a runaway
  // client, a bug), not normal polling.
  const rl = checkRateLimit(`admin_requests_poll:${auth.user.email}`, 60, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const adminClient = createSupabaseAdminClient();

  const { data, error } = await adminClient
    .from('user_devices')
    .select('id, device_id, ip_address, device_label, first_seen, user:user_id(id, email)')
    .eq('status', 'pending')
    .order('first_seen', { ascending: false })
    .limit(MAX_RESULTS);

  if (error) return NextResponse.json({ error: 'Could not load requests.' }, { status: 400 });

  const requests = (data ?? []).map((row) => {
    const user = row.user as unknown as { id: string; email: string } | null;
    return {
      id: row.id as string,
      device_id: row.device_id as string,
      ip_address: row.ip_address as string,
      device_label: row.device_label as string,
      first_seen: row.first_seen as string,
      user_id: user?.id ?? null,
      user_email: user?.email ?? 'Unknown user',
    };
  });

  return NextResponse.json({ requests, count: requests.length });
}
