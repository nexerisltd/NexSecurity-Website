/**
 * The persistent "device identity" cookie.
 *
 * This is the actual device identity per NexSecurity's device-authorization
 * policy — a random id planted once per browser install and never rotated,
 * so the same phone/laptop/browser profile is recognized as the *same*
 * device even when its IP changes (home wifi -> mobile data -> a friend's
 * router). IP is only ever secondary/history from here on (see
 * user_devices.ip_history in supabase/schema.sql and lib/auth.ts).
 *
 * Deliberately NOT under 'server-only': middleware.ts (edge runtime) needs
 * these same constants to set the cookie, and edge middleware cannot import
 * server-only/next/headers code.
 */
export const DEVICE_ID_COOKIE = 'nsx_device_id';

export const DEVICE_ID_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
  // 10 years — this cookie IS the device's identity; it should outlive
  // any realistic session and only go away if the user clears cookies or
  // an admin revokes the device server-side.
  maxAge: 60 * 60 * 24 * 365 * 10,
};
