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
    await supabase.auth.signOut();
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
    await supabase.auth.signOut();
    await logAuditEvent('LOGIN_DENIED', email);
    return NextResponse.redirect(`${origin}/login?error=access_denied`);
  }

  await logAuditEvent('LOGIN_SUCCESS', email);
  return NextResponse.redirect(`${origin}/learn`);
}
