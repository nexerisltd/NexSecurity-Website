import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { tokenMismatchReportSchema } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rateLimit';
import { logAuditEvent, countSecurityIncidents } from '@/lib/audit';
import { maybeAutoBlockAccount } from '@/lib/autoBlock';

export const dynamic = 'force-dynamic';

/**
 * Receives worker/src/index.ts's fire-and-forget report when it detects
 * a `t=` token being used from an IP that doesn't match the one it was
 * minted for, or a single token pulling segments far faster than real
 * playback (see reportSuspiciousActivity there). This is the Worker's
 * ONLY way to reach Supabase-backed enforcement, kept deliberately
 * indirect (see worker/src/index.ts's own doc comment on why it never
 * calls Supabase itself) — this route does the actual account lookup and
 * calls the SAME lib/autoBlock.ts helper app/api/security/incident/
 * route.ts uses for DevTools detections, so both signals feed one
 * enforcement path.
 *
 * NOT gated by requireAuthorized() — the caller is the Worker itself,
 * not a logged-in browser, so there's no user session to check. Instead
 * gated by a shared secret header (SECURITY_WEBHOOK_SECRET, set the same
 * on both sides — see worker/wrangler.toml) so this can't be used by a
 * random internet POST to get someone else auto-blocked.
 */
export async function POST(request: NextRequest) {
  const expectedSecret = process.env.SECURITY_WEBHOOK_SECRET;
  const providedSecret = request.headers.get('x-security-webhook-secret');
  if (!expectedSecret || !providedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Access denied.' }, { status: 401 });
  }

  // Backstop against a misbehaving/compromised caller hammering this
  // route — keyed globally (not per-user, since there's no user session
  // here) since the caller is a single trusted Worker, not many
  // independent browsers.
  const rl = checkRateLimit('token_mismatch_webhook', 120, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const body = await request.json().catch(() => null);
  const parsed = tokenMismatchReportSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input.' }, { status: 400 });

  const adminClient = createSupabaseAdminClient();
  const { data: user } = await adminClient
    .from('authorized_users')
    .select('id, email, role, auto_block_on_incident, blocked_until, block_reason')
    .eq('id', parsed.data.aid)
    .maybeSingle();

  // Account no longer exists (removed since the token was minted) —
  // nothing to block, nothing to log against. Not an error from the
  // Worker's point of view; it already got its 403/warning decided
  // locally before firing this report.
  if (!user) return NextResponse.json({ ok: true, skipped: 'user_not_found' });

  const metadataBase = {
    reason: parsed.data.reason,
    video_id: parsed.data.videoId,
    worker_uid: parsed.data.uid,
    ip: parsed.data.ip,
  };

  const incidentId = await logAuditEvent(
    'SUSPICIOUS_SECURITY_EVENT',
    user.email,
    user.id,
    metadataBase,
    'pending'
  );

  const attemptNumber = await countSecurityIncidents(user.id);

  // Unlike a DevTools detection (an intentional user action — see
  // app/api/security/incident/route.ts, which blocks on the very first
  // one), a single ip_mismatch/burst_fetch report is deliberately NOT
  // enough to auto-block by itself: a phone genuinely hopping from wifi
  // to mobile data mid-playback can legitimately trip ip_mismatch once
  // (its currently-in-flight token was minted for the old IP; the NEXT
  // refresh, ~10s later, mints a fresh one for the new IP and succeeds —
  // see STREAM_TOKEN_REFRESH_MS in components/VideoPlayer.tsx) and that
  // is not the same thing as someone else playing a copied link. Only
  // REPEATED reports for this account within a short window — the
  // pattern an actual shared/leaked link produces, since it keeps
  // getting used from the wrong place over and over — cross the line
  // into "block it". A confirmed real leak still gets caught fast: this
  // window is minutes, not the 24h block duration itself.
  const REPEAT_WINDOW_MINUTES = 10;
  const REPEAT_THRESHOLD = 3;
  const windowStart = new Date(Date.now() - REPEAT_WINDOW_MINUTES * 60_000).toISOString();
  const { count: recentCount } = await adminClient
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('target', user.id)
    .eq('event_type', 'SUSPICIOUS_SECURITY_EVENT')
    .gte('created_at', windowStart);

  if ((recentCount ?? 0) < REPEAT_THRESHOLD) {
    return NextResponse.json({ ok: true, watching: true, recentCount: recentCount ?? 1 });
  }

  const label = parsed.data.reason === 'ip_mismatch'
    ? 'a stream link repeatedly used from a different network than it was issued to'
    : 'a stream link repeatedly pulling video data far faster than normal playback';

  const { blockedUntil, blockReason } = await maybeAutoBlockAccount(
    user,
    'USER_AUTO_BLOCKED',
    `Automatic: ${label} (${recentCount} reports in ${REPEAT_WINDOW_MINUTES}m, attempt #${attemptNumber})`,
    { ...metadataBase, incident_id: incidentId, attempt_number: attemptNumber, recent_count: recentCount }
  );

  return NextResponse.json({ ok: true, blockedUntil, blockReason });
}
