import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { deviceApprovalSchema, uuidSchema } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rateLimit';
import { logAuditEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';

// user_devices / device_sightings have no SELECT policy for anyone but
// admins (see supabase/schema.sql) — read through the admin client,
// consistent with videos/e_books.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const parsedId = uuidSchema.safeParse(params.id);
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });

  const adminClient = createSupabaseAdminClient();
  const [{ data: devices }, { data: sightings }] = await Promise.all([
    adminClient
      .from('user_devices')
      .select('id, ip_address, device_label, status, label, created_at')
      .eq('user_id', parsedId.data)
      .order('created_at', { ascending: false }),
    adminClient
      .from('device_sightings')
      .select('id, ip_address, device_label, first_seen, last_seen, sighting_count')
      .eq('user_id', parsedId.data)
      .order('last_seen', { ascending: false })
      .limit(30),
  ]);

  const decided = new Set((devices ?? []).map((d) => `${d.ip_address}|${d.device_label}`));

  // "Unauthorized IP request" = seen, but neither approved nor
  // restricted yet — no row in user_devices at all for this combo.
  const pending = (sightings ?? []).filter(
    (s) => !decided.has(`${s.ip_address}|${s.device_label}`)
  );

  return NextResponse.json({
    authorized: (devices ?? []).filter((d) => d.status === 'authorized'),
    restricted: (devices ?? []).filter((d) => d.status === 'restricted'),
    pending,
  });
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const rl = checkRateLimit(`admin_mutate:${auth.user.email}`, 30, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const parsedId = uuidSchema.safeParse(params.id);
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const parsed = deviceApprovalSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input.' }, { status: 400 });

  const adminClient = createSupabaseAdminClient();
  const { data, error } = await adminClient
    .from('user_devices')
    .upsert(
      {
        user_id: parsedId.data,
        ip_address: parsed.data.ip_address,
        device_label: parsed.data.device_label,
        status: parsed.data.status,
        label: parsed.data.label ?? null,
      },
      { onConflict: 'user_id,ip_address,device_label' }
    )
    .select('id')
    .single();

  if (error) return NextResponse.json({ error: 'Could not save device decision.' }, { status: 400 });

  // Approving (or restricting) ANY device for this user is what turns on
  // enforcement — from that point on, only decided (authorized) combos
  // work; everything else needs an explicit admin decision.
  await adminClient
    .from('authorized_users')
    .update({ restrict_devices: true })
    .eq('id', parsedId.data)
    .eq('restrict_devices', false);

  await logAuditEvent('ADMIN_ACTION', auth.user.email, parsedId.data, {
    action: parsed.data.status === 'restricted' ? 'DEVICE_RESTRICTED' : 'DEVICE_APPROVED',
    ip_address: parsed.data.ip_address,
    device_label: parsed.data.device_label,
  });

  return NextResponse.json({ device: data }, { status: 201 });
}
