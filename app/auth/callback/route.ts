import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/audit';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  // Throttle callback hits per-IP to blunt abuse of the auth flow.
  const rl = checkRateLimit(`auth_callback:${getClientIp(request)}`, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.redirect(`${origin}/auth/auth-code-error`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/auth-code-error`);
  }

  const supabase = createSupabaseServerClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    return NextResponse.redirect(`${origin}/auth/auth-code-error`);
  }

  // ---- Authentication succeeded. Now enforce authorization. ----
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const email = user?.email?.toLowerCase();

  if (!email) {
    // scope: 'local' — this only clears THIS just-created (and about to be
    // discarded) session. The default 'global' scope would instead revoke
    // every refresh token on the account, including any other device's
    // already-authorized, perfectly valid session — an edge case here
    // (Google somehow returned no email) has no business logging someone
    // out of their desktop.
    await supabase.auth.signOut({ scope: 'local' });
    return NextResponse.redirect(`${origin}/auth/auth-code-error`);
  }

  const { data: authorizedUser } = await supabase
    .from('authorized_users')
    .select('status')
    .eq('email', email)
    .maybeSingle();

  const isActive = authorizedUser?.status === 'ACTIVE';

  if (!isActive) {
    // Critical: destroy the session immediately. Authentication succeeding
    // must never leave behind an app-usable session for an unauthorized email.
    // scope: 'local' — same reasoning as the branch above: this device's
    // own login attempt failed authorization, which says nothing about
    // any other device already legitimately signed in on this account.
    // (An admin actually disabling someone's account is still enforced on
    // every request regardless of session validity — see getAuth() in
    // lib/auth.ts, which checks authorized_users.status independently —
    // so scope: 'local' here doesn't weaken that enforcement at all.)
    await supabase.auth.signOut({ scope: 'local' });
    await logAuditEvent('LOGIN_DENIED', email);
    return NextResponse.redirect(`${origin}/login?error=access_denied`);
  }

  await logAuditEvent('LOGIN_SUCCESS', email);
  return NextResponse.redirect(`${origin}/learn`);
}
