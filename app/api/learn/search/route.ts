import { NextResponse, type NextRequest } from 'next/server';
import { requireAuthorized } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

// Powers the "Search anything…" box in TopNav (Ctrl/Cmd+K). Deliberately
// scoped to the `boards` table only: it goes through createSupabaseServerClient
// (the user's own session), so Postgres RLS — not application code —
// decides what's visible. A regular user only ever gets published
// boards back; an admin gets everything, drafts included. Videos and
// e-books are intentionally NOT searched here: those tables have no
// regular-user SELECT policy at all (see supabase/schema.sql), and every
// existing read of them goes through a bespoke authorization check
// (board-published + admin client) rather than RLS. Reusing that logic
// here would mean a second place to keep it correct — not worth it for
// a nav search box.
export async function GET(request: NextRequest) {
  const auth = await requireAuthorized();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const rl = checkRateLimit(`learn_search:${auth.user.email}`, 60, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const q = request.nextUrl.searchParams.get('q')?.trim().slice(0, 100) ?? '';
  if (q.length < 2) return NextResponse.json({ boards: [] });

  // Escape PostgREST ilike wildcards so a search for e.g. "50%" behaves
  // literally instead of as a pattern.
  const escaped = q.replace(/[%_]/g, (c) => `\\${c}`);

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('boards')
    .select('id, title, board_type, published')
    .ilike('title', `%${escaped}%`)
    .order('title', { ascending: true })
    .limit(8);

  if (error) return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  return NextResponse.json({ boards: data });
}
