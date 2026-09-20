import 'server-only';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export type AuditEventType =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_DENIED'
  | 'USER_ADDED'
  | 'USER_REMOVED'
  | 'USER_DISABLED'
  | 'USER_ENABLED'
  | 'USER_ROLE_CHANGED'
  | 'ADMIN_ACTION'
  | 'BOARD_CREATED'
  | 'BOARD_UPDATED'
  | 'BOARD_DELETED'
  | 'BOARD_ACCESS_UPDATED'
  | 'VIDEO_ACCESS_GRANTED'
  | 'VIDEO_ACCESS_DENIED'
  | 'COMMENT_DELETED'
  // Security Incident Lock & Review Screen (see app/api/security/incident/
  // route.ts and components/DevToolsGuard.tsx). Frontend DevTools
  // detection is a deterrent, not proof of anything — these two types
  // exist so the admin side (app/admin/security/page.tsx) can tell "the
  // page-side heuristic fired" apart from an actual confirmed decision,
  // which only a human reviewer makes (see REVIEW_STATUSES below).
  | 'DEVTOOLS_DETECTED'
  | 'SUSPICIOUS_SECURITY_EVENT'
  // Enforcement half of the above (see supabase/migrations/0017_temp_block.sql).
  // AUTO fires from app/api/security/incident/route.ts the moment an
  // incident is recorded for an account with auto_block_on_incident on;
  // the MANUAL/UNBLOCKED pair fire from an admin's own action in
  // app/api/admin/users/[id]/block/route.ts.
  | 'USER_AUTO_BLOCKED'
  | 'USER_MANUALLY_BLOCKED'
  | 'USER_UNBLOCKED'
  // A device was turned away by the concurrent-stream cap (see
  // getConcurrentSessionLimit() in app/api/video/[id]/stream-token/
  // route.ts) — informational, NOT part of the
  // DEVTOOLS_DETECTED/SUSPICIOUS_SECURITY_EVENT review queue or the
  // auto-block pipeline those feed: a student's 3rd device is far more
  // often "forgot laptop was still open" than actual account sharing,
  // so this doesn't get treated as an incident by itself.
  | 'CONCURRENT_SESSION_LIMIT_HIT';

/** Only ever set on the two security-incident event types above — every
 * other row's review_status stays null forever (see
 * supabase/migrations/0015_security_incidents.sql). */
export const REVIEW_STATUSES = ['pending', 'reviewed', 'false_positive', 'confirmed_abuse', 'action_taken'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export type AuditRow = {
  id: number;
  event_type: string;
  actor_email: string | null;
  target: string | null;
  metadata: Record<string, unknown>;
  review_status: ReviewStatus | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

/**
 * Fire-and-forget audit log write. Deliberately swallows its own errors
 * so a logging failure can never block or crash the actual request —
 * but never logs secrets, tokens, or full request bodies.
 *
 * `reviewStatus` is only ever passed for the two security-incident event
 * types (defaults them to 'pending' — see app/api/security/incident/
 * route.ts); every other call site leaves it unset and the column stays
 * null, same as it always has been.
 *
 * Returns the new row's id (or null on failure) so a caller that needs
 * to deep-link back to THIS exact incident — see notifySecurityIncident
 * in lib/webPush.ts — can do so; every other existing call site already
 * ignored this function's return value and keeps working unchanged.
 */
export async function logAuditEvent(
  eventType: AuditEventType,
  actorEmail: string | null,
  target?: string,
  metadata: Record<string, unknown> = {},
  reviewStatus?: ReviewStatus
): Promise<number | null> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from('audit_logs')
      .insert({
        event_type: eventType,
        actor_email: actorEmail,
        target: target ?? null,
        metadata,
        review_status: reviewStatus ?? null,
      })
      .select('id')
      .single();
    if (error) throw error;
    return data.id as number;
  } catch (err) {
    console.error('[audit] failed to write audit log', eventType, err);
    return null;
  }
}

/** How many DEVTOOLS_DETECTED/SUSPICIOUS_SECURITY_EVENT rows this user
 * (by id, stored as `target`) has ever triggered, INCLUDING the one just
 * inserted by the caller — this is what makes "attempt #3" on the lock
 * screen mean something real rather than a client-guessed counter that
 * resets on refresh. Counts across every device, on purpose: the thing
 * being tracked is the account's history, not one browser's. */
export async function countSecurityIncidents(userId: string): Promise<number> {
  try {
    const supabase = createSupabaseAdminClient();
    const { count } = await supabase
      .from('audit_logs')
      .select('id', { count: 'exact', head: true })
      .eq('target', userId)
      .in('event_type', ['DEVTOOLS_DETECTED', 'SUSPICIOUS_SECURITY_EVENT']);
    return count ?? 0;
  } catch (err) {
    console.error('[audit] failed to count security incidents', err);
    // A failed count should never look like "zero prior incidents" to
    // an admin — but it also must never block the incident itself from
    // being recorded (the caller already inserted it before calling
    // this). 1 is the honest floor: we know AT LEAST this one happened.
    return 1;
  }
}
