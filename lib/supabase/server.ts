import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Server-side Supabase client, scoped to the incoming request's cookies.
 * Uses the ANON key only — every protected read/write goes through
 * Postgres Row-Level Security (see supabase/schema.sql), so this client
 * can never see or touch data the requesting user isn't authorized for.
 *
 * The SERVICE ROLE key is intentionally not used here. It is only ever
 * loaded in an isolated, explicitly-named helper (lib/supabase/admin.ts,
 * created separately when you're ready to wire it up) so it's obvious at
 * a glance which code paths bypass RLS.
 */
export function createSupabaseServerClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Called from a Server Component render — the middleware
            // below is what actually persists refreshed session cookies.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch {
            // See note above.
          }
        },
      },
    }
  );
}
