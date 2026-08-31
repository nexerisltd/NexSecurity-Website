import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { filterAccessibleBoards } from '@/lib/boardAccess';
import { BoardsSearchGrid } from '@/components/BoardsSearchGrid';

export const dynamic = 'force-dynamic';

export default async function LearnPage() {
  const auth = await getAuth();

  if (auth.state === 'UNAUTHENTICATED') redirect('/login');
  if (auth.state === 'UNAUTHORIZED') redirect('/login?error=access_denied');
  if (auth.state === 'DEVICE_BLOCKED') redirect('/login?error=device_blocked');

  const supabase = createSupabaseServerClient();

  // RLS restricts this to published boards for non-admins automatically —
  // this query cannot return unpublished content even if the filter
  // below were removed. 'restricted' boards ARE published (visibility is
  // a separate axis) and still come back here — filterAccessibleBoards
  // below is what hides the ones this user has no grant for.
  const { data: boardRows } = await supabase
    .from('boards')
    .select('id, title, description, thumbnail_url, visibility')
    .is('parent_id', null)
    .eq('published', true)
    .order('sort_order', { ascending: true });

  const adminClient = createSupabaseAdminClient();
  const boards = await filterAccessibleBoards(
    adminClient,
    auth.user.email,
    boardRows ?? [],
    auth.user.role === 'ADMIN'
  );

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal-glow">
        Learn
      </p>
      <h1 className="mt-2 font-display text-2xl font-semibold text-ink">
        Your learning space
      </h1>

      {!boards || boards.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-vault-border p-10 text-center">
          <p className="text-sm text-ink-dim">
            Nothing has been published here yet. Check back soon.
          </p>
        </div>
      ) : (
        <BoardsSearchGrid
          boards={boards}
          placeholder="Search your classes…"
          emptyMessage="Nothing has been published here yet. Check back soon."
        />
      )}
    </main>
  );
}

