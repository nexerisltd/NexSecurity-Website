import { NextResponse, type NextRequest } from 'next/server';
import { requireAuthorized } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { securityIncidentSchema } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rateLimit';
import { logAuditEvent, countSecurityIncidents } from '@/lib/audit';
import { notifySecurityIncident } from '@/lib/webPush';
import { getClientIp, getDeviceLabel, getDeviceId, splitDeviceLabel } from '@/lib/requestInfo';

export const dynamic = 'force-dynamic';

// Configurable per section 7 of the spec: leave the actual enforcement
// threshold to whoever runs this deployment rather than hard-coding a
// number this codebase has no real policy backing yet. Unset/invalid ->
// no limit is enforced and the lock screen shows "No limit configured"
// for Remaining Attempts instead of a number — this route only ever
// RECORDS incidents either way; deciding what happens at N attempts
// (if anything) is left to whatever reviews audit_logs, not this route.
function getMaxSecurityAttempts(): number | null {
  const raw = process.env.MAX_SECURITY_ATTEMPTS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Records a client-reported security incident (DevTools detected — see
 * components/DevToolsGuard.tsx) and returns everything the lock screen
 * (components/SecurityIncidentScreen.tsx) needs to render its info
 * table: user/device identity pulled from the SAME device-identity
 * system every other protected route already uses (lib/auth.ts,
 * lib/requestInfo.ts, user_devices), not a second one invented for this
 * feature.
 *
 * This is a RECORDING endpoint, not an access-control decision by
 * itself — requireAuthorized() confirms the account is real and active,
 * same as every other protected route, but nothing here bans or
 * disables anyone. A human reviewing app/admin/security/page.tsx decides
 * whether an incident was actually piracy/abuse; frontend DevTools
 * detection alone is treated as a signal, never as proof (see
 * DEVTOOLS_DETECTED vs the review_status column added in
 * supabase/migrations/0015_security_incidents.sql).
 */
// How long an auto-block from a single detected incident lasts before it
// expires on its own (see supabase/migrations/0017_temp_block.sql —
// blocked_until in the past is the same as not blocked). Configurable per
// deployment, same reasoning as MAX_SECURITY_ATTEMPTS below: this route
// has no real policy opinion baked in beyond "block by default", so the
// actual duration is left to whoever runs this.
function getAutoBlockMinutes(): number {
  const raw = process.env.AUTO_BLOCK_MINUTES;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60 * 24; // default: 24h
}

export async function POST(request: NextRequest) {
  const auth = await requireAuthorized();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  // Admins are a trusted role that legitimately needs DevTools for real
  // admin/debug work on this same site (see isAdmin in
  // components/DevToolsGuard.tsx, which already skips detection
  // client-side) — this is the server-side half of that same exemption,
  // so an admin never gets locked or logged even if an old cached
  // bundle, a modified client, or a future bug still fires the report.
  // `{ skip: true }` rather than an error status: DevToolsGuard.tsx
  // checks this and deliberately does NOT lock the screen, whereas a
  // genuine error response there intentionally DOES still lock (see its
  // catch block) — an admin hitting this path is not an error condition
  // to fail closed on.
  if (auth.user.role === 'ADMIN') return NextResponse.json({ skip: true });

  // A buggy/looping detector on the client should never be able to
  // flood audit_logs — this is a backstop, not the primary defense
  // (DevToolsGuard.tsx already debounces so a real trigger only ever
  // fires once per page load).
  const rl = checkRateLimit(`security_incident:${auth.user.email}`, 10, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const body = await request.json().catch(() => null);
  const parsed = securityIncidentSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input.' }, { status: 400 });

  const ip = getClientIp();
  const deviceLabelHeader = getDeviceLabel();
  const deviceId = getDeviceId();

  // Reuses the SAME user_devices row every device-approval screen in
  // the admin panel already reads from — not a second, competing
  // device record for this feature. Falls back to the header-derived
  // label/an "unknown" status only in the rare case this device hasn't
  // been upserted into user_devices yet (see the fire-and-forget call
  // in lib/auth.ts's getAuth() for unrestricted accounts).
  let deviceRow: { device_label: string; status: string } | null = null;
  if (deviceId) {
    const adminClient = createSupabaseAdminClient();
    const { data } = await adminClient
      .from('user_devices')
      .select('device_label, status')
      .eq('user_id', auth.user.id)
      .eq('device_id', deviceId)
      .maybeSingle();
    deviceRow = data;
  }

  const { os, browser } = splitDeviceLabel(deviceLabelHeader);
  const detectionTime = new Date().toISOString();
  const resolvedDeviceLabel = deviceRow?.device_label ?? deviceLabelHeader;

  const incidentId = await logAuditEvent(
    parsed.data.detectionType,
    auth.user.email,
    auth.user.id,
    {
      device_id: deviceId,
      device_label: resolvedDeviceLabel,
      device_status: deviceRow?.status ?? 'unknown',
      ip,
      os,
      browser,
      screen: parsed.data.screen_width && parsed.data.screen_height
        ? `${parsed.data.screen_width}×${parsed.data.screen_height}`
        : null,
      viewport: parsed.data.viewport_width && parsed.data.viewport_height
        ? `${parsed.data.viewport_width}×${parsed.data.viewport_height}`
        : null,
    },
    'pending'
  );

  // Fire-and-forget, same as every other notify* call in this codebase
  // (see lib/auth.ts's own device-request notification) — a slow/failed
  // push send should never delay the lock screen actually appearing for
  // the student who triggered this.
  if (incidentId !== null) {
    void notifySecurityIncident(auth.user.email, resolvedDeviceLabel, parsed.data.detectionType, incidentId).catch(
      (err) => console.error('[push] security-incident notification failed', err)
    );
  }

  const attemptNumber = await countSecurityIncidents(auth.user.id);
  const maxAttempts = getMaxSecurityAttempts();
  const remainingAttempts = maxAttempts !== null ? Math.max(0, maxAttempts - attemptNumber) : null;

  // Enforcement (see supabase/migrations/0017_temp_block.sql). Blocks on
  // THIS very incident — not waiting for a threshold to be crossed —
  // because a caught DevTools session already means the leak attempt
  // happened; per-account auto_block_on_incident (default on, flippable
  // from the admin's user detail page) is the opt-out for an account an
  // admin trusts enough not to auto-block, not a retry budget. Skips
  // entirely for admins (never reachable here anyway — see the early
  // `{ skip: true }` return above) and for an account already blocked
  // further out than this would set it (an admin's own longer manual
  // block should never get shortened by a routine auto-block).
  let blockedUntil: string | null = null;
  let blockReason: string | null = null;
  if (auth.user.auto_block_on_incident) {
    const candidateUntil = new Date(Date.now() + getAutoBlockMinutes() * 60_000).toISOString();
    const existingUntil = auth.user.blocked_until;
    if (!existingUntil || new Date(existingUntil).getTime() < new Date(candidateUntil).getTime()) {
      blockedUntil = candidateUntil;
      blockReason = `Automatic: ${parsed.data.detectionType.replace(/_/g, ' ').toLowerCase()} (attempt #${attemptNumber})`;

      const adminClient = createSupabaseAdminClient();
      const { error: blockError } = await adminClient
        .from('authorized_users')
        .update({ blocked_until: blockedUntil, block_reason: blockReason })
        .eq('id', auth.user.id);

      if (blockError) {
        console.error('[security] failed to auto-block account', blockError);
        blockedUntil = null;
        blockReason = null;
      } else {
        await logAuditEvent('USER_AUTO_BLOCKED', auth.user.email, auth.user.id, {
          incident_id: incidentId,
          detection_type: parsed.data.detectionType,
          blocked_until: blockedUntil,
          attempt_number: attemptNumber,
        });
      }
    } else {
      blockedUntil = existingUntil;
      blockReason = auth.user.block_reason;
    }
  }

  return NextResponse.json({
    nsUserId: auth.user.id,
    accountIdentifier: auth.user.email,
    deviceName: resolvedDeviceLabel,
    deviceId: deviceId ?? 'Not available from browser',
    deviceApprovalStatus: deviceRow?.status ?? 'Not tracked (device restriction is off for this account)',
    ip,
    os,
    browser,
    detectionTime,
    detectionType: parsed.data.detectionType,
    attemptNumber,
    remainingAttempts,
    blockedUntil,
    blockReason,
  });
}
