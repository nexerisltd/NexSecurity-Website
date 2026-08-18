import { redirect, notFound } from 'next/navigation';
import { getAuth } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation';
import { TopNav } from '@/components/TopNav';
import { VideoPlayer } from '@/components/VideoPlayer';

export const dynamic = 'force-dynamic';

export default async function VideoPage({ params }: { params: { id: string } }) {
  const auth = await getAuth();
  if (auth.state === 'UNAUTHENTICATED') redirect('/login');
  if (auth.state === 'UNAUTHORIZED') redirect('/login?error=access_denied');

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
    .select('id, title, description, board:board_id(id, published, parent_id)')
    .eq('id', videoId)
    .maybeSingle();

  const board = video?.board as unknown as { id: string; published: boolean; parent_id: string | null } | null;

  if (!video || !board || !board.published) notFound();

  return (
    <div className="min-h-screen bg-vault-950">
      <TopNav
        email={auth.email}
        isAdmin={auth.user.role === 'ADMIN'}
        backHref={`/learn/board/${board.id}`}
      />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <VideoPlayer videoId={video.id} />
        <h1 className="mt-6 font-display text-xl font-semibold text-ink">{video.title}</h1>
        {video.description && (
          <p className="mt-2 text-sm leading-relaxed text-ink-dim">{video.description}</p>
        )}
      </main>
    </div>
  );
}
