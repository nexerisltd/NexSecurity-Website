import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type AuthorizedUser = {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
  status: 'ACTIVE' | 'DISABLED';
};

export type AuthResult =
  | { state: 'UNAUTHENTICATED' }
  | { state: 'UNAUTHORIZED'; email: string }
  | { state: 'AUTHORIZED'; email: string; user: AuthorizedUser };

/**
 * THE security boundary. Every protected Server Component and Route
 * Handler must call this and branch on the result before touching any
 * protected data. Nothing about this function trusts the client:
 *  - the session itself is re-validated against Supabase Auth (server-side)
 *  - the email is looked up in authorized_users through RLS, which only
 *    lets the caller see their own row (see supabase/schema.sql)
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
    .select('id, email, role, status')
    .eq('email', user.email.toLowerCase())
    .maybeSingle();

  if (!authorizedUser || authorizedUser.status !== 'ACTIVE') {
    return { state: 'UNAUTHORIZED', email: user.email };
  }

  return {
    state: 'AUTHORIZED',
    email: user.email,
    user: authorizedUser as AuthorizedUser,
  };
}

/** Convenience guard for routes/pages that require ANY authorized user. */
export async function requireAuthorized(): Promise<
  { ok: true; user: AuthorizedUser } | { ok: false; status: 401 | 403 }
> {
  const auth = await getAuth();
  if (auth.state === 'UNAUTHENTICATED') return { ok: false, status: 401 };
  if (auth.state === 'UNAUTHORIZED') return { ok: false, status: 403 };
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
