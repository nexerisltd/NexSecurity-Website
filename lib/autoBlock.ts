import 'server-only';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { logAuditEvent, type AuditEventType } from '@/lib/audit';

// How long an auto-block from a single detected incident lasts before it
// expires on its own (see supabase/migrations/0017_temp_block.sql —
// blocked_until in the past is the same as not blocked). Configurable per
// deployment: this has no real policy opinion baked in beyond "block by
// default", so the actual duration is left to whoever runs this.
export function getAutoBlockMinutes(): number {
  const raw = process.env.AUTO_BLOCK_MINUTES;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60 * 24; // default: 24h
}

/**
 * The one place that actually sets blocked_until/block_reason on an
 * account — called from app/api/security/incident/route.ts (DevTools
 * detected) and app/api/security/token-mismatch/route.ts (Worker-
 * reported IP mismatch / burst fetch), so both signals feed the exact
 * same enforcement instead of two competing implementations.
 *
 * Never shortens an existing, further-out block (an admin's own longer
 * manual block should never get shortened by a routine auto-block landing
 * on top of it) and does nothing at all for an account with
 * auto_block_on_incident off or for an ADMIN (mirrors the isRestricted /
 * DevToolsGuard admin carve-outs elsewhere in this codebase).
 *
 * Returns the blockedUntil/blockReason actually in effect afterward (which
 * may be the account's PRE-EXISTING block, if that one already runs
 * later than this call would have set) — or nulls if nothing is blocked
 * and auto-block didn't apply. Never throws; a failure here must never
 * break the caller's own response (recording the incident, or answering
 * the Worker's webhook).
 */
export async function maybeAutoBlockAccount(
  user: { id: string; email: string; role: 'USER' | 'ADMIN'; auto_block_on_incident: boolean; blocked_until: string | null; block_reason: string | null },
  auditEventType: AuditEventType,
  reasonSummary: string,
  metadata: Record<string, unknown>
): Promise<{ blockedUntil: string | null; blockReason: string | null }> {
  if (user.role === 'ADMIN' || !user.auto_block_on_incident) {
    return { blockedUntil: user.blocked_until, blockReason: user.block_reason };
  }

  const candidateUntil = new Date(Date.now() + getAutoBlockMinutes() * 60_000).toISOString();
  const existingUntil = user.blocked_until;
  if (existingUntil && new Date(existingUntil).getTime() >= new Date(candidateUntil).getTime()) {
    return { blockedUntil: existingUntil, blockReason: user.block_reason };
  }

  const blockReason = reasonSummary;
  try {
    const adminClient = createSupabaseAdminClient();
    const { error } = await adminClient
      .from('authorized_users')
      .update({ blocked_until: candidateUntil, block_reason: blockReason })
      .eq('id', user.id);
    if (error) throw error;

    await logAuditEvent(auditEventType, user.email, user.id, {
      ...metadata,
      blocked_until: candidateUntil,
    });

    return { blockedUntil: candidateUntil, blockReason };
  } catch (err) {
    console.error('[security] failed to auto-block account', err);
    return { blockedUntil: user.blocked_until, blockReason: user.block_reason };
  }
}
