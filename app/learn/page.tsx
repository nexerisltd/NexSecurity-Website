import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { TopNav } from '@/components/TopNav';
import { BoardCard } from '@/components/BoardCard';
import { SearchableGrid } from '@/components/SearchableGrid';

export const dynamic = 'force-dynamic';

export default async function LearnPage() {
  const auth = await getAuth();

  if (auth.state === 'UNAUTHENTICATED') redirect('/login');
  if (auth.state === 'UNAUTHORIZED') redirect('/login?error=access_denied');
  if (auth.state === 'DEVICE_BLOCKED') redirect('/login?error=device_blocked');

  const supabase = createSupabaseServerClient();

  // RLS restricts this to published boards for non-admins automatically —
  // this query cannot return unpublished or unauthorized content even if
  // the filter below were removed.
  const { data: boards } = await supabase
    .from('boards')
    .select('id, title, description, thumbnail_url')
    .is('parent_id', null)
    .eq('published', true)
    .order('sort_order', { ascending: true });

  return (
    <div className="min-h-screen bg-vault-950">
      <TopNav email={auth.email} isAdmin={auth.user.role === 'ADMIN'} profile={auth.profile} />

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
          <SearchableGrid
            items={boards}
            getKey={(b) => b.id}
            getSearchText={(b) => `${b.title} ${b.description ?? ''}`}
            placeholder="Search your classes…"
            emptyMessage="Nothing has been published here yet. Check back soon."
            gridClassName="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
            renderItem={(board) => (
              <BoardCard
                href={`/learn/board/${board.id}`}
                title={board.title}
                description={board.description}
                thumbnailUrl={board.thumbnail_url}
              />
            )}
          />
        )}
      </main>
    </div>
  );
}
