import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getClientIp, getDeviceLabel } from '@/lib/requestInfo';

export type AuthorizedUser = {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
  status: 'ACTIVE' | 'DISABLED';
  restrict_devices: boolean;
};

export type AuthResult =
  | { state: 'UNAUTHENTICATED' }
  | { state: 'UNAUTHORIZED'; email: string }
  | { state: 'DEVICE_BLOCKED'; email: string; ip: string; deviceLabel: string }
  | { state: 'AUTHORIZED'; email: string; user: AuthorizedUser };

/**
 * Fire-and-forget upsert of "this user was just seen from this IP +
 * device". Recorded for EVERY authorized request, regardless of whether
 * restrict_devices is on, so an admin reviewing a suspicious account has
 * real history to approve from instead of a blank list. Never blocks or
 * throws into the caller.
 */
async function recordDeviceSighting(userId: string, ip: string, deviceLabel: string) {
  try {
    const adminClient = createSupabaseAdminClient();
    const { data: existing } = await adminClient
      .from('device_sightings')
      .select('id, sighting_count')
      .eq('user_id', userId)
      .eq('ip_address', ip)
      .eq('device_label', deviceLabel)
      .maybeSingle();

    if (existing) {
      await adminClient
        .from('device_sightings')
        .update({ last_seen: new Date().toISOString(), sighting_count: existing.sighting_count + 1 })
        .eq('id', existing.id);
    } else {
      await adminClient.from('device_sightings').insert({
        user_id: userId,
        ip_address: ip,
        device_label: deviceLabel,
      });
    }
  } catch (err) {
    console.error('[auth] failed to record device sighting', err);
  }
}

/**
 * THE security boundary. Every protected Server Component and Route
 * Handler must call this and branch on the result before touching any
 * protected data. Nothing about this function trusts the client:
 *  - the session itself is re-validated against Supabase Auth (server-side)
 *  - the email is looked up in authorized_users through RLS, which only
 *    lets the caller see their own row (see supabase/schema.sql)
 *  - if that account has restrict_devices on, the request's IP + coarse
 *    device label (see lib/requestInfo.ts) must match a row an admin
 *    explicitly approved in user_devices — this is what stops one
 *    account being shared across many people's devices at once (see
 *    app/admin/users/[id]/page.tsx and components/VideoPlayer.tsx's
 *    heartbeat, which re-runs this check periodically during playback so
 *    an already-open tab gets cut off too, not just future page loads)
 *
 * A user reaching this point with a valid session but no ACTIVE row in
 * authorized_users is UNAUTHORIZED, full stop — regardless of anything
 * the frontend, cookies, or request claims.
 */
export async function getAuth(): Promise<AuthResult> {
  const supabase = createSupabaseServerClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user || !user.email) {
    return { state: 'UNAUTHENTICATED' };
  }

  const { data: authorizedUser } = await supabase
    .from('authorized_users')
    .select('id, email, role, status, restrict_devices')
    .eq('email', user.email.toLowerCase())
    .maybeSingle();

  if (!authorizedUser || authorizedUser.status !== 'ACTIVE') {
    return { state: 'UNAUTHORIZED', email: user.email };
  }

  const typedUser = authorizedUser as AuthorizedUser;
  const ip = getClientIp();
  const deviceLabel = getDeviceLabel();

  // Always record the sighting — even when not currently restricted —
  // so the admin panel has data to approve from the moment restriction
  // is turned on, not after.
  void recordDeviceSighting(typedUser.id, ip, deviceLabel);

  if (typedUser.restrict_devices) {
    const adminClient = createSupabaseAdminClient();
    const { data: approved } = await adminClient
      .from('user_devices')
      .select('id')
      .eq('user_id', typedUser.id)
      .eq('ip_address', ip)
      .eq('device_label', deviceLabel)
      .maybeSingle();

    if (!approved) {
      return { state: 'DEVICE_BLOCKED', email: user.email, ip, deviceLabel };
    }
  }

  return {
    state: 'AUTHORIZED',
    email: user.email,
    user: typedUser,
  };
}

/** Convenience guard for routes/pages that require ANY authorized user. */
export async function requireAuthorized(): Promise<
  { ok: true; user: AuthorizedUser } | { ok: false; status: 401 | 403 }
> {
  const auth = await getAuth();
  if (auth.state === 'UNAUTHENTICATED') return { ok: false, status: 401 };
  if (auth.state === 'UNAUTHORIZED') return { ok: false, status: 403 };
  if (auth.state === 'DEVICE_BLOCKED') return { ok: false, status: 403 };
  return { ok: true, user: auth.user };
}

/** Convenience guard for routes/pages that require an ADMIN. */
export async function requireAdmin(): Promise<
  { ok: true; user: AuthorizedUser } | { ok: false; status: 401 | 403 }
> {
  const result = await requireAuthorized();
  if (!result.ok) return result;
  if (result.user.role !== 'ADMIN') return { ok: false, status: 403 };
  return result;
}
