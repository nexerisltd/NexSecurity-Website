import { NextResponse, type NextRequest } from 'next/server';
import { requireAuthorized } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

// Powers the "Search classes and boards…" box in TopNav (Ctrl/Cmd+K).
//
// Boards go through createSupabaseServerClient (the user's own session),
// so Postgres RLS decides what's visible — a regular user only ever gets
// published boards back, an admin gets everything including drafts. Note
// RLS here does NOT filter by "restricted" per-user grants (see
// boards_select_authorized in supabase/schema.sql) — same as the board
// listing itself, a restricted board's title is visible in search, but
// actually opening it still hits the real access-denied check on
// /learn/board/[id]. Title-only exposure of something you already know
// exists by name isn't a new leak.
//
// Classes (videos) have no regular-user SELECT policy at all — every
// existing read of that table goes through the admin client after a
// bespoke authorization check. This route follows that same pattern:
// admin client, then application-code filtering down to
// `published = true` on both the video AND its board, which is exactly
// the same visibility rule the board page itself applies. A non-admin
// never sees a class that isn't actually reachable; an admin sees
// everything, same as boards.
export async function GET(request: NextRequest) {
  const auth = await requireAuthorized();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const rl = checkRateLimit(`learn_search:${auth.user.email}`, 60, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const q = request.nextUrl.searchParams.get('q')?.trim().slice(0, 100) ?? '';
  if (q.length < 2) return NextResponse.json({ results: [] });

  // Escape PostgREST ilike wildcards so a search for e.g. "50%" behaves
  // literally instead of as a pattern.
  const escaped = q.replace(/[%_]/g, (c) => `\\${c}`);
  const isAdmin = auth.user.role === 'ADMIN';

  const supabase = createSupabaseServerClient();
  const adminClient = createSupabaseAdminClient();

  const [{ data: boards, error: boardsError }, { data: videos, error: videosError }] = await Promise.all([
    supabase
      .from('boards')
      .select('id, title, board_type, published')
      .ilike('title', `%${escaped}%`)
      .order('title', { ascending: true })
      .limit(8),
    isAdmin
      ? adminClient
          .from('videos')
          .select('id, title, published, board:board_id(published)')
          .ilike('title', `%${escaped}%`)
          .order('title', { ascending: true })
          .limit(8)
      : adminClient
          .from('videos')
          .select('id, title, published, board:board_id!inner(published)')
          .eq('published', true)
          .eq('board.published', true)
          .ilike('title', `%${escaped}%`)
          .order('title', { ascending: true })
          .limit(8),
  ]);

  // One half failing must never blank out the other — a board-search
  // regression caused by a class-search bug (or vice versa) is worse
  // than just class results being briefly incomplete. Log server-side,
  // degrade gracefully client-side.
  if (boardsError) console.error('learn/search boards query failed:', boardsError.message);
  if (videosError) console.error('learn/search videos query failed:', videosError.message);
  if (boardsError && videosError) {
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }

  const boardResults = (boards ?? []).map((b) => ({
    type: 'board' as const,
    id: b.id,
    title: b.title,
    board_type: b.board_type,
    published: b.published,
  }));

  const videoResults = (videos ?? []).map((v) => ({
    type: 'class' as const,
    id: v.id,
    title: v.title,
    published: v.published && (v.board as unknown as { published: boolean } | null)?.published !== false,
  }));

  // Interleave-by-relevance is overkill for a max-16-item palette — title
  // alphabetical within each type, boards first (they're what most
  // searches are actually browsing for; a specific class name is the
  // exception, not the common case).
  return NextResponse.json({ results: [...boardResults, ...videoResults] });
}
