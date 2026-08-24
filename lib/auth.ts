import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getClientIp, getDeviceLabel, getDeviceId } from '@/lib/requestInfo';

export type AuthorizedUser = {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
  status: 'ACTIVE' | 'DISABLED';
  restrict_devices: boolean;
};

export type DeviceStatus = 'pending' | 'authorized' | 'restricted' | 'blocked';

export type AuthResult =
  | { state: 'UNAUTHENTICATED' }
  | { state: 'UNAUTHORIZED'; email: string }
  | { state: 'DEVICE_BLOCKED'; email: string; ip: string; deviceLabel: string; deviceStatus: DeviceStatus | 'unknown' }
  | { state: 'AUTHORIZED'; email: string; user: AuthorizedUser };

/** How many recent {ip, at} entries to keep per device. Bounded so a
 * device that roams a lot doesn't grow this row forever — an admin
 * reviewing a device only needs recent history, not a full log
 * (audit_logs is where a full trail belongs). */
const IP_HISTORY_LIMIT = 20;

/**
 * Finds (or creates, as 'pending') this user's row for THIS device_id,
 * records the current IP into its history, and returns the device's
 * current status.
 *
 * device_id — not IP, not User-Agent — is the device's identity (see
 * lib/deviceId.ts). This is what makes "1 account = unlimited devices"
 * actually work: the same phone stays the same device across a wifi ->
 * mobile-data switch, instead of looking like a brand-new device every
 * time its IP changes.
 *
 * Called for EVERY authorized request, regardless of whether
 * restrict_devices is on, so an admin reviewing a suspicious account (or
 * turning restriction on for the first time) has real device history to
 * decide from instead of a blank list. Never throws into the caller.
 */
async function upsertDeviceAndGetStatus(
  userId: string,
  deviceId: string,
  ip: string,
  deviceLabel: string
): Promise<DeviceStatus> {
  try {
    const adminClient = createSupabaseAdminClient();
    const nowIso = new Date().toISOString();

    const { data: existing } = await adminClient
      .from('user_devices')
      .select('id, status, ip_history')
      .eq('user_id', userId)
      .eq('device_id', deviceId)
      .maybeSingle();

    if (existing) {
      const history: { ip: string; at: string }[] = Array.isArray(existing.ip_history)
        ? existing.ip_history
        : [];
      const alreadyKnown = history.some((entry) => entry.ip === ip);
      const nextHistory = alreadyKnown
        ? history
        : [...history, { ip, at: nowIso }].slice(-IP_HISTORY_LIMIT);

      await adminClient
        .from('user_devices')
        .update({
          last_seen: nowIso,
          ip_address: ip,
          ip_history: nextHistory,
          device_label: deviceLabel,
        })
        .eq('id', existing.id);

      return existing.status as DeviceStatus;
    }

    // Never seen before for this user -> a brand-new "New Device
    // Request", pending admin approval.
    await adminClient.from('user_devices').insert({
      user_id: userId,
      device_id: deviceId,
      ip_address: ip,
      ip_history: [{ ip, at: nowIso }],
      device_label: deviceLabel,
      status: 'pending',
      first_seen: nowIso,
      last_seen: nowIso,
    });
    return 'pending';
  } catch (err) {
    console.error('[auth] failed to upsert device', err);
    // Fail closed only for the caller that actually cares (restricted
    // accounts check the return value); for unrestricted accounts this
    // is fire-and-forget and the error never reaches anyone.
    return 'pending';
  }
}

/**
 * THE security boundary. Every protected Server Component and Route
 * Handler must call this and branch on the result before touching any
 * protected data. Nothing about this function trusts the client:
 *  - the session itself is re-validated against Supabase Auth (server-side)
 *  - the email is looked up in authorized_users through RLS, which only
 *    lets the caller see their own row (see supabase/schema.sql)
 *  - if that account has restrict_devices on, the request's device_id
 *    (see lib/deviceId.ts) must have status 'authorized' in
 *    user_devices — an admin explicitly approved it — or the request is
 *    DEVICE_BLOCKED. This is what stops one account being shared across
 *    many people's devices at once (see app/admin/users/[id]/page.tsx
 *    and components/VideoPlayer.tsx's heartbeat, which re-runs this
 *    check periodically during playback so an already-open tab gets cut
 *    off too, not just future page loads).
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
  const deviceId = getDeviceId();

  if (!deviceId) {
    // The device-identity cookie hasn't round-tripped to the browser yet
    // (see lib/deviceId.ts) — extremely rare in practice, since it's
    // planted on every path including the OAuth redirect chain that gets
    // a user here in the first place. Only accounts under restriction
    // need to care; treat it as "not yet approved" rather than guessing.
    if (typedUser.restrict_devices) {
      return { state: 'DEVICE_BLOCKED', email: user.email, ip, deviceLabel, deviceStatus: 'unknown' };
    }
    return { state: 'AUTHORIZED', email: user.email, user: typedUser };
  }

  if (typedUser.restrict_devices) {
    // Restriction is on for this account: the status decision gates
    // access, so it must be awaited before we can answer.
    const status = await upsertDeviceAndGetStatus(typedUser.id, deviceId, ip, deviceLabel);
    if (status !== 'authorized') {
      return { state: 'DEVICE_BLOCKED', email: user.email, ip, deviceLabel, deviceStatus: status };
    }
  } else {
    // Not restricted — still record the sighting so an admin has real
    // device history to review the moment they turn restriction on, but
    // don't make this request wait on it.
    void upsertDeviceAndGetStatus(typedUser.id, deviceId, ip, deviceLabel);
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
