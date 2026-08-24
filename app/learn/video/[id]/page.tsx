import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getAuth } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation';
import { TopNav } from '@/components/TopNav';
import { VideoPlayer } from '@/components/VideoPlayer';
import { VideoDownloadButton } from '@/components/VideoDownloadButton';
import { PartsList } from '@/components/PartsList';

export const dynamic = 'force-dynamic';

export default async function VideoPage({ params }: { params: { id: string } }) {
  const auth = await getAuth();
  if (auth.state === 'UNAUTHENTICATED') redirect('/login');
  if (auth.state === 'UNAUTHORIZED') redirect('/login?error=access_denied');
  if (auth.state === 'DEVICE_BLOCKED') redirect('/login?error=device_blocked');

  const parsedId = uuidSchema.safeParse(params.id);
  if (!parsedId.success) notFound();
  const videoId = parsedId.data;

  // Metadata-only lookup (title/description/thumbnail) via the admin
  // client, since RLS blocks non-admin reads of `videos` entirely. This
  // NEVER selects source_ref — that only ever happens inside the /play
  // route, right before minting a short-lived signed URL.
  const adminClient = createSupabaseAdminClient();
  const { data: video } = await adminClient
    .from('videos')
    .select(
      'id, title, description, download_url, board:board_id(id, title, published, parent_id), video_resources(id, title, url, sort_order)'
    )
    .eq('id', videoId)
    .maybeSingle();

  const board = video?.board as unknown as {
    id: string;
    title: string;
    published: boolean;
    parent_id: string | null;
  } | null;

  if (!video || !board || !board.published) notFound();

  const resources = (video.video_resources ?? []).sort(
    (a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order
  );

  // Parent board (for the breadcrumb) and sibling boards under that same
  // parent (for "You may also like") — only fetched when this board is
  // nested one level deep, matching the 2-level grouping used elsewhere
  // (see app/page.tsx's topLevelTitle for the same reasoning).
  const { data: parentBoard } = board.parent_id
    ? await adminClient.from('boards').select('id, title').eq('id', board.parent_id).maybeSingle()
    : { data: null };

  const siblingScopeParentId = board.parent_id ?? board.id;
  const { data: siblingBoardsRaw } = await adminClient
    .from('boards')
    .select('id, title')
    .eq('parent_id', siblingScopeParentId)
    .eq('published', true)
    .neq('id', board.id)
    .limit(6);
  const siblingBoards = siblingBoardsRaw ?? [];

  // Sibling parts within the same board/chapter (Part 1, Part 2, ...).
  // Safe to fetch via the admin client the same way as the video itself
  // — authorization for this board was already established above, and
  // these siblings belong to the exact same board.
  const { data: siblingVideos } = await adminClient
    .from('videos')
    .select('id, title, thumbnail_url, sort_order')
    .eq('board_id', board.id)
    .order('sort_order', { ascending: true });

  const parts = siblingVideos ?? [];

  let recommended: { id: string; title: string; thumbnail_url: string | null; boardTitle: string }[] = [];
  if (siblingBoards.length > 0) {
    const { data: recRaw } = await adminClient
      .from('videos')
      .select('id, title, thumbnail_url, board_id, created_at')
      .in(
        'board_id',
        siblingBoards.map((b) => b.id)
      )
      .order('created_at', { ascending: false })
      .limit(3);
    const boardTitleById = new Map(siblingBoards.map((b) => [b.id, b.title]));
    recommended = (recRaw ?? []).map((v) => ({
      id: v.id,
      title: v.title,
      thumbnail_url: v.thumbnail_url,
      boardTitle: boardTitleById.get(v.board_id) ?? '',
    }));
  }

  return (
    <div className="min-h-screen bg-vault-950">
      <TopNav email={auth.email} isAdmin={auth.user.role === 'ADMIN'} backHref={`/learn/board/${board.id}`} />

      <main className="mx-auto max-w-6xl px-6 py-8">
        <nav className="flex flex-wrap items-center gap-1.5 text-sm text-ink-faint">
          <Link href="/learn" className="text-signal hover:underline">
            Learn
          </Link>
          {parentBoard && (
            <>
              <span>›</span>
              <Link href={`/learn/board/${parentBoard.id}`} className="text-signal hover:underline">
                {parentBoard.title}
              </Link>
            </>
          )}
          <span>›</span>
          <span className="text-ink-dim">{board.title}</span>
        </nav>

        <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
          <div className="min-w-0">
            <VideoPlayer videoId={video.id} />

            <div className="mt-6 flex flex-wrap items-start justify-between gap-3">
              <h1 className="font-display text-xl font-semibold text-ink">{video.title}</h1>
              <VideoDownloadButton videoId={video.id} fallbackUrl={video.download_url} />
            </div>

            {resources.length > 0 && (
              <div className="mt-6 border-t border-vault-border pt-5">
                <p className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">Resources</p>
                <div className="mt-3 space-y-2">
                  {resources.map((r: { id: string; title: string; url: string }) => (
                    <a
                      key={r.id}
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 rounded-lg border border-vault-border bg-vault-900 px-4 py-3 text-sm text-ink transition hover:border-signal backdrop-blur-xl shadow-glass"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="shrink-0 text-signal" aria-hidden="true">
                        <path
                          d="M6 3.5h8l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V5A1.5 1.5 0 0 1 5.5 3.5H6Zm8 0V8h4"
                          stroke="currentColor"
                          strokeWidth="1.7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <span className="flex-1 truncate">{r.title}</span>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="shrink-0 text-ink-faint" aria-hidden="true">
                        <path
                          d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14"
                          stroke="currentColor"
                          strokeWidth="1.7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {video.description && (
              <div className="mt-6 border-t border-vault-border pt-5">
                <p className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">Description</p>
                <p className="mt-2 text-sm leading-relaxed text-ink-dim">{video.description}</p>
              </div>
            )}
          </div>

          <div className="space-y-6">
            {parts.length > 1 && (
              <div className="rounded-xl border border-vault-border bg-vault-900 p-4 backdrop-blur-xl shadow-glass">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-ink">Course Content</p>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
                    {parts.length} parts
                  </span>
                </div>
                <div className="mt-3">
                  <PartsList parts={parts} activeId={video.id} />
                </div>
              </div>
            )}

            {recommended.length > 0 && (
              <div className="rounded-xl border border-vault-border bg-vault-900 p-4 backdrop-blur-xl shadow-glass">
                <p className="text-sm font-semibold text-ink">You may also like</p>
                <div className="mt-3 space-y-3">
                  {recommended.map((r) => (
                    <Link key={r.id} href={`/learn/video/${r.id}`} className="flex items-center gap-3 group">
                      <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded-md bg-vault-800">
                        {r.thumbnail_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.thumbnail_url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-ink-faint" aria-hidden="true">
                              <path d="M8 5v14l11-7-11-7Z" fill="currentColor" />
                            </svg>
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-ink group-hover:text-signal">{r.title}</p>
                        <p className="truncate text-xs text-ink-faint">{r.boardTitle}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
