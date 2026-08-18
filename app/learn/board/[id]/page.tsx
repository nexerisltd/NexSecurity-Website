import { redirect, notFound } from 'next/navigation';
import { getAuth } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation';
import { TopNav } from '@/components/TopNav';
import { BoardCard } from '@/components/BoardCard';

export const dynamic = 'force-dynamic';

export default async function BoardPage({ params }: { params: { id: string } }) {
  const auth = await getAuth();
  if (auth.state === 'UNAUTHENTICATED') redirect('/login');
  if (auth.state === 'UNAUTHORIZED') redirect('/login?error=access_denied');

  // Validate the ID shape before it ever touches a query — malformed IDs
  // (IDOR probing, injection attempts) are rejected immediately.
  const parsedId = uuidSchema.safeParse(params.id);
  if (!parsedId.success) notFound();
  const boardId = parsedId.data;

  const supabase = createSupabaseServerClient();

  // RLS enforces: non-admins only ever see this row if published = true.
  // An unpublished or nonexistent board id returns null either way, so
  // the response can't be used to distinguish "exists but hidden" from
  // "doesn't exist" — that ambiguity is the point.
  const { data: board } = await supabase
    .from('boards')
    .select('id, title, description, thumbnail_url, published, destination_page_id')
    .eq('id', boardId)
    .maybeSingle();

  if (!board) notFound();

  // Case 1: this board points at a page — show that page's boards.
  if (board.destination_page_id) {
    const { data: page } = await supabase
      .from('pages')
      .select('id, title, description')
      .eq('id', board.destination_page_id)
      .maybeSingle();

    const { data: pageBoards } = await supabase
      .from('page_boards')
      .select('sort_order, board:board_id(id, title, description, thumbnail_url, published)')
      .eq('page_id', board.destination_page_id)
      .order('sort_order', { ascending: true });

    const children = (pageBoards ?? [])
      .map((pb) => pb.board as any)
      .filter((b) => b && b.published);

    return (
      <BoardListView
        auth={auth}
        heading={page?.title ?? board.title}
        description={page?.description}
        backHref="/learn"
        items={children}
      />
    );
  }

  // Case 2: this board has published child boards.
  const { data: childBoards } = await supabase
    .from('boards')
    .select('id, title, description, thumbnail_url')
    .eq('parent_id', boardId)
    .eq('published', true)
    .order('sort_order', { ascending: true });

  if (childBoards && childBoards.length > 0) {
    return (
      <BoardListView
        auth={auth}
        heading={board.title}
        description={board.description}
        backHref="/learn"
        items={childBoards}
      />
    );
  }

  // Case 3: leaf board — look for an attached video. This is the ONLY
  // place a non-admin's request touches the videos table, and it's done
  // through the admin client specifically because RLS otherwise blocks
  // all non-admin reads of that table. Authorization has already been
  // fully established above (authenticated + authorized + board published)
  // before we do this lookup.
  const adminClient = createSupabaseAdminClient();
  const { data: video } = await adminClient
    .from('videos')
    .select('id')
    .eq('board_id', boardId)
    .maybeSingle();

  if (video) {
    redirect(`/learn/video/${video.id}`);
  }

  // Published leaf board with nothing attached yet.
  return (
    <div className="min-h-screen bg-vault-950">
      <TopNav email={auth.email} isAdmin={auth.user.role === 'ADMIN'} backHref="/learn" />
      <main className="mx-auto max-w-6xl px-6 py-16 text-center">
        <p className="text-sm text-ink-dim">This board doesn&apos;t have any content yet.</p>
      </main>
    </div>
  );
}

function BoardListView({
  auth,
  heading,
  description,
  backHref,
  items,
}: {
  auth: { email: string; user: { role: string } };
  heading: string;
  description?: string | null;
  backHref: string;
  items: { id: string; title: string; description?: string | null; thumbnail_url?: string | null }[];
}) {
  return (
    <div className="min-h-screen bg-vault-950">
      <TopNav email={auth.email} isAdmin={auth.user.role === 'ADMIN'} backHref={backHref} />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="font-display text-2xl font-semibold text-ink">{heading}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm text-ink-dim">{description}</p>}

        {items.length === 0 ? (
          <div className="mt-10 rounded-xl border border-dashed border-vault-border p-10 text-center">
            <p className="text-sm text-ink-dim">Nothing published here yet.</p>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <BoardCard
                key={item.id}
                href={`/learn/board/${item.id}`}
                title={item.title}
                description={item.description}
                thumbnailUrl={item.thumbnail_url}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
