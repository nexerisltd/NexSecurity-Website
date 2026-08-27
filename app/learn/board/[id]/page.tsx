import { redirect, notFound } from 'next/navigation';
import { getAuth } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation';
import Image from 'next/image';
import { TopNav } from '@/components/TopNav';
import { BoardCard } from '@/components/BoardCard';
import { VideoCard } from '@/components/VideoCard';
import { EBookCard } from '@/components/EBookCard';
import { SearchableGrid } from '@/components/SearchableGrid';

export const dynamic = 'force-dynamic';

export default async function BoardPage({ params }: { params: { id: string } }) {
  const auth = await getAuth();
  if (auth.state === 'UNAUTHENTICATED') redirect('/login');
  if (auth.state === 'UNAUTHORIZED') redirect('/login?error=access_denied');
  if (auth.state === 'DEVICE_BLOCKED') redirect('/login?error=device_blocked');

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
    .select(
      'id, title, description, thumbnail_url, published, destination_page_id, board_type, routine_image_url'
    )
    .eq('id', boardId)
    .maybeSingle();

  if (!board) notFound();

  // Case 0: a 'routine' board skips the board/video hierarchy entirely —
  // it's just a title, description, and a single 16:9 image (the routine
  // itself, e.g. a class timetable graphic).
  if (board.board_type === 'routine') {
    return (
      <div className="min-h-screen bg-vault-950">
        <TopNav email={auth.email} isAdmin={auth.user.role === 'ADMIN'} backHref="/learn" profile={auth.profile} />
        <main className="mx-auto max-w-4xl px-6 py-10">
          <h1 className="font-display text-2xl font-semibold text-ink">{board.title}</h1>
          {board.description && (
            <p className="mt-2 max-w-2xl text-sm text-ink-dim">{board.description}</p>
          )}
          <div className="relative mt-6 aspect-video w-full overflow-hidden rounded-xl border border-vault-border bg-vault-900 backdrop-blur-xl shadow-glass">
            {board.routine_image_url ? (
              <Image
                src={board.routine_image_url}
                alt={board.title}
                fill
                sizes="(min-width: 1024px) 896px, 100vw"
                className="object-contain"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-faint">
                  Routine not uploaded yet
                </span>
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

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

  // Case 3: leaf board — show every class attached to it (as a grid, like
  // a chapter's video list) plus any e-books, instead of jumping straight
  // into Part 1. This is the ONLY place a non-admin's request touches the
  // videos/e_books tables, and it's done through the admin client
  // specifically because RLS otherwise blocks all non-admin reads of
  // those tables. Authorization has already been fully established above
  // (authenticated + authorized + board published) before these lookups.
  const adminClient = createSupabaseAdminClient();
  const [{ data: videos }, { data: ebooks }] = await Promise.all([
    adminClient
      .from('videos')
      .select('id, title, description, thumbnail_url, sort_order, video_resources(title)')
      .eq('board_id', boardId)
      .order('sort_order', { ascending: true }),
    adminClient
      .from('e_books')
      .select('id, title, thumbnail_url, download_url, format, price, sort_order')
      .eq('board_id', boardId)
      .order('sort_order', { ascending: true }),
  ]);

  const hasVideos = videos && videos.length > 0;
  const hasEbooks = ebooks && ebooks.length > 0;

  if (!hasVideos && !hasEbooks) {
    // Published leaf board with nothing attached yet.
    return (
      <div className="min-h-screen bg-vault-950">
        <TopNav email={auth.email} isAdmin={auth.user.role === 'ADMIN'} backHref="/learn" profile={auth.profile} />
        <main className="mx-auto max-w-6xl px-6 py-16 text-center">
          <p className="text-sm text-ink-dim">This board doesn&apos;t have any content yet.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-vault-950">
      <TopNav email={auth.email} isAdmin={auth.user.role === 'ADMIN'} backHref="/learn" profile={auth.profile} />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="font-display text-2xl font-semibold text-ink">{board.title}</h1>
        {board.description && (
          <p className="mt-2 max-w-2xl text-sm text-ink-dim">{board.description}</p>
        )}

        {hasVideos && (
          <>
            <p className="mt-8 font-mono text-[11px] uppercase tracking-widest text-ink-faint">
              {videos!.length} {videos!.length === 1 ? 'class' : 'classes'} available
            </p>
            <SearchableGrid
              items={videos!}
              getKey={(v) => v.id}
              getSearchText={(v) => `${v.title} ${v.description ?? ''}`}
              placeholder="Search classes…"
              emptyMessage="No classes yet."
              gridClassName="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
              renderItem={(v) => {
                const i = videos!.findIndex((x) => x.id === v.id);
                return (
                  <VideoCard
                    href={`/learn/video/${v.id}`}
                    partLabel={`#${i + 1}`}
                    title={v.title}
                    description={v.description}
                    thumbnailUrl={v.thumbnail_url}
                    resourceLabels={(v.video_resources ?? []).map((r: { title: string }) => r.title)}
                  />
                );
              }}
            />
          </>
        )}

        {hasEbooks && (
          <>
            <p className="mt-10 font-mono text-[11px] uppercase tracking-widest text-ink-faint">
              E-Books
            </p>
            <SearchableGrid
              items={ebooks!}
              getKey={(eb) => eb.id}
              getSearchText={(eb) => eb.title}
              placeholder="Search e-books…"
              emptyMessage="No e-books yet."
              gridClassName="mt-4 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4"
              renderItem={(eb) => (
                <EBookCard
                  title={eb.title}
                  thumbnailUrl={eb.thumbnail_url}
                  downloadUrl={eb.download_url}
                  format={eb.format}
                  price={Number(eb.price)}
                />
              )}
            />
          </>
        )}
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
  auth: { email: string; user: { role: string }; profile: { avatarUrl: string | null; fullName: string | null } };
  heading: string;
  description?: string | null;
  backHref: string;
  items: { id: string; title: string; description?: string | null; thumbnail_url?: string | null }[];
}) {
  return (
    <div className="min-h-screen bg-vault-950">
      <TopNav email={auth.email} isAdmin={auth.user.role === 'ADMIN'} backHref={backHref} profile={auth.profile} />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="font-display text-2xl font-semibold text-ink">{heading}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm text-ink-dim">{description}</p>}

        {items.length === 0 ? (
          <div className="mt-10 rounded-xl border border-dashed border-vault-border p-10 text-center">
            <p className="text-sm text-ink-dim">Nothing published here yet.</p>
          </div>
        ) : (
          <SearchableGrid
            items={items}
            getKey={(item) => item.id}
            getSearchText={(item) => `${item.title} ${item.description ?? ''}`}
            placeholder="Search…"
            emptyMessage="Nothing published here yet."
            gridClassName="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
            renderItem={(item) => (
              <BoardCard
                href={`/learn/board/${item.id}`}
                title={item.title}
                description={item.description}
                thumbnailUrl={item.thumbnail_url}
              />
            )}
          />
        )}
      </main>
    </div>
  );
}
