import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

const PUBLIC_PATHS = ['/login', '/auth/callback', '/auth/auth-code-error'];

export async function middleware(request: NextRequest) {
  // Always refresh the session cookie first.
  const response = await updateSession(request);

  const { pathname } = request.nextUrl;
  const isPublic =
    pathname === '/' || // public marketing landing page
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/')) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon');

  // IMPORTANT: this is a UX convenience redirect only. It reads the
  // session cookie's presence, nothing more. It does NOT check the
  // authorized_users allowlist or role — that happens server-side in
  // every page/route via lib/auth.ts, which is the real security boundary.
  // Do not add authorization logic here; middleware has no reliable
  // access to Postgres/RLS state and must never be treated as the gate.
  if (!isPublic) {
    const hasSessionCookie = request.cookies
      .getAll()
      .some((c) => c.name.includes('-auth-token'));
    if (!hasSessionCookie) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
