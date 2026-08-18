import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser client. Only ever holds the ANON key (public by design).
 * This client cannot read or write anything RLS doesn't allow for the
 * currently authenticated user — it is not a trust boundary, Postgres is.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
