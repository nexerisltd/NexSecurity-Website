import { redirect, notFound } from 'next/navigation';
import { getAuth } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation';
import { canAccessBoard, filterAccessibleBoards } from '@/lib/boardAccess';
import { RoutineImageViewer } from '@/components/RoutineImageViewer';
import { BoardsSearchGrid } from '@/components/BoardsSearchGrid';
import { VideosSearchGrid } from '@/components/VideosSearchGrid';
import { BoardEbooksGrid } from '@/components/BoardEbooksGrid';

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
  const adminClient = createSupabaseAdminClient();
  const isAdmin = auth.user.role === 'ADMIN';

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

  // "Restricted" board visibility — walks the FULL ancestor chain, so a
  // user locked out of a parent board can't reach this page directly by
  // its own URL either, even if this specific board is itself universal.
  // Same "not found" response as the published-check above, for the same
  // reason: no way to distinguish "hidden" from "doesn't exist".
  if (!(await canAccessBoard(adminClient, auth.user.email, boardId, isAdmin))) notFound();


  // Case 0: a 'routine' board skips the board/video hierarchy entirely —
  // it's just a title, description, and a single 16:9 image (the routine
  // itself, e.g. a class timetable graphic).
  if (board.board_type === 'routine') {
    return (
      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold text-ink">{board.title}</h1>
            {board.description && (
              <p className="mt-2 max-w-2xl text-sm text-ink-dim">{board.description}</p>
            )}
          </div>
          {board.routine_image_url && (
            <a
              href={`/api/routine/${board.id}/download`}
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-signal px-3.5 py-2 text-sm font-medium text-white transition hover:bg-signal-glow"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Download
            </a>
          )}
        </div>
        <div className="relative mt-6 aspect-video w-full overflow-hidden rounded-xl border border-vault-border bg-vault-900 backdrop-blur-xl shadow-glass">
          {board.routine_image_url ? (
            <RoutineImageViewer src={board.routine_image_url} alt={board.title} />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-faint">
                Routine not uploaded yet
              </span>
            </div>
          )}
        </div>
      </main>
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
      .select('sort_order, board:board_id(id, title, description, thumbnail_url, published, visibility)')
      .eq('page_id', board.destination_page_id)
      .order('sort_order', { ascending: true });

    const published = (pageBoards ?? [])
      .map((pb) => pb.board as any)
      .filter((b) => b && b.published);
    const children = await filterAccessibleBoards(adminClient, auth.user.email, published, isAdmin);

    return (
      <BoardListView heading={page?.title ?? board.title} description={page?.description} items={children} />
    );
  }

  // Case 2: this board has published child boards.
  const { data: childBoardRows } = await supabase
    .from('boards')
    .select('id, title, description, thumbnail_url, visibility')
    .eq('parent_id', boardId)
    .eq('published', true)
    .order('sort_order', { ascending: true });

  const childBoards = await filterAccessibleBoards(adminClient, auth.user.email, childBoardRows ?? [], isAdmin);

  if (childBoards.length > 0) {
    return <BoardListView heading={board.title} description={board.description} items={childBoards} />;
  }

  // Case 3: leaf board — show every class attached to it (as a grid, like
  // a chapter's video list) plus any e-books, instead of jumping straight
  // into Part 1. This is the ONLY place a non-admin's request touches the
  // videos/e_books tables, and it's done through the admin client
  // specifically because RLS otherwise blocks all non-admin reads of
  // those tables. Authorization has already been fully established above
  // (authenticated + authorized + board published + board visibility)
  // before these lookups. (adminClient itself was already created above,
  // for the visibility/access checks.)
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
      <main className="mx-auto max-w-6xl px-6 py-16 text-center">
        <p className="text-sm text-ink-dim">This board doesn&apos;t have any content yet.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="font-display text-2xl font-semibold text-ink">{board.title}</h1>
      {board.description && <p className="mt-2 max-w-2xl text-sm text-ink-dim">{board.description}</p>}

      {hasVideos && (
        <>
          <p className="mt-8 font-mono text-[11px] uppercase tracking-widest text-ink-faint">
            {videos!.length} {videos!.length === 1 ? 'class' : 'classes'} available
          </p>
          <VideosSearchGrid videos={videos!} />
        </>
      )}

      {hasEbooks && (
        <>
          <p className="mt-10 font-mono text-[11px] uppercase tracking-widest text-ink-faint">E-Books</p>
          <BoardEbooksGrid ebooks={ebooks!} />
        </>
      )}
    </main>
  );
}

function BoardListView({
  heading,
  description,
  items,
}: {
  heading: string;
  description?: string | null;
  items: { id: string; title: string; description?: string | null; thumbnail_url?: string | null }[];
}) {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="font-display text-2xl font-semibold text-ink">{heading}</h1>
      {description && <p className="mt-2 max-w-2xl text-sm text-ink-dim">{description}</p>}

      {items.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-vault-border p-10 text-center">
          <p className="text-sm text-ink-dim">Nothing published here yet.</p>
        </div>
      ) : (
        <BoardsSearchGrid boards={items} placeholder="Search…" emptyMessage="Nothing published here yet." />
      )}
    </main>
  );
}
