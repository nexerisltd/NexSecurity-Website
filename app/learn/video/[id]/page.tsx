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

  return (
    <div className="min-h-screen bg-vault-950">
      <TopNav
        email={auth.email}
        isAdmin={auth.user.role === 'ADMIN'}
        backHref={`/learn/board/${board.id}`}
      />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <p className="font-mono text-[11px] uppercase tracking-widest text-signal-glow">
          {board.title}
        </p>
        <VideoPlayer videoId={video.id} />
        <div className="mt-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-xl font-semibold text-ink">{video.title}</h1>
            {video.description && (
              <p className="mt-2 text-sm leading-relaxed text-ink-dim">{video.description}</p>
            )}
          </div>
          <VideoDownloadButton videoId={video.id} fallbackUrl={video.download_url} />
        </div>

        {resources.length > 0 && (
          <div className="mt-8 border-t border-vault-border pt-6">
            <p className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">
              Resources
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              {resources.map((r: { id: string; title: string; url: string }) => (
                <a
                  key={r.id}
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-lg border border-vault-border bg-vault-900 px-4 py-2.5 text-sm text-ink transition hover:border-signal hover:text-signal-glow backdrop-blur-xl shadow-glass"
                >
                  <span aria-hidden>📄</span>
                  {r.title}
                </a>
              ))}
            </div>
          </div>
        )}

        {parts.length > 1 && (
          <div className="mt-8 border-t border-vault-border pt-6">
            <p className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">
              {board.title} · {parts.length} parts
            </p>
            <div className="mt-3">
              <PartsList parts={parts} activeId={video.id} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
