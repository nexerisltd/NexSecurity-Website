import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * Service-role client. This BYPASSES Row-Level Security entirely, so it
 * is deliberately isolated in this one file instead of being callable
 * from lib/supabase/server.ts.
 *
 * Only import this from:
 *   - lib/audit.ts              (inserting audit log rows)
 *   - app/api/video/[id]/play   (reading the private video source_ref
 *                                 and minting a signed playback URL,
 *                                 AFTER lib/auth.ts + a board-authorization
 *                                 check have already passed)
 *
 * Never import this in a Server Component that renders based on
 * unvalidated input, and never let its result reach the client directly.
 *
 * SUPABASE_SERVICE_ROLE_KEY must be set ONLY as a server-side env var
 * (Vercel Project Settings → Environment Variables, not exposed with a
 * NEXT_PUBLIC_ prefix). If it's missing, this throws loudly instead of
 * silently falling back to the anon key.
 */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL is not configured on the server.'
    );
  }

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
