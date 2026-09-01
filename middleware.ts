import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { DEVICE_ID_COOKIE, DEVICE_ID_COOKIE_OPTIONS } from '@/lib/deviceId';

const PUBLIC_PATHS = [
  '/login',
  '/auth/callback',
  '/auth/auth-code-error',
  '/privacy',
  '/terms',
  '/manifest.json',
  '/sw.js',
  '/.well-known',
];

/**
 * Plants the device-identity cookie on the very first request from a
 * browser, on EVERY path (not just protected ones) — a visitor's device
 * identity should already exist by the time they reach /login and sign
 * in, not get created mid-auth-flow. Mutating request.cookies and
 * rebuilding NextResponse.next({ request }) (same pattern as
 * lib/supabase/middleware.ts's updateSession) makes the cookie readable
 * via next/headers' cookies() later in THIS same request — not just on
 * the next one.
 */
export async function middleware(request: NextRequest) {
  const isNewDevice = !request.cookies.get(DEVICE_ID_COOKIE)?.value;
  if (isNewDevice) {
    request.cookies.set(DEVICE_ID_COOKIE, crypto.randomUUID());
  }
  const deviceId = request.cookies.get(DEVICE_ID_COOKIE)!.value;

  // Always refresh the session cookie first.
  const response = await updateSession(request);

  if (isNewDevice) {
    response.cookies.set(DEVICE_ID_COOKIE, deviceId, DEVICE_ID_COOKIE_OPTIONS);
  }

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
