import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { TopNav } from '@/components/TopNav';
import { EBookCard } from '@/components/EBookCard';

export const dynamic = 'force-dynamic';

type Row = {
  id: string;
  title: string;
  thumbnail_url: string | null;
  download_url: string | null;
  format: string;
  price: number;
  board: { id: string; title: string } | null;
};

export default async function EBooksPage() {
  const auth = await getAuth();
  if (auth.state === 'UNAUTHENTICATED') redirect('/login');
  if (auth.state === 'UNAUTHORIZED') redirect('/login?error=access_denied');

  // e_books has no public SELECT policy (see supabase/schema.sql) — same
  // reasoning as videos, so this reads through the admin client. The
  // `board:board_id!inner(..., published)` + `.eq('board.published', true)`
  // pair below is what performs the authorization: only e-books attached
  // to a currently-published board are ever returned to a non-admin here.
  const adminClient = createSupabaseAdminClient();
  const { data: ebooks } = await adminClient
    .from('e_books')
    .select('id, title, thumbnail_url, download_url, format, price, board:board_id!inner(id, title, published)')
    .eq('board.published', true)
    .order('board_id', { ascending: true })
    .order('sort_order', { ascending: true });

  const rows = (ebooks ?? []) as unknown as Row[];

  const grouped = new Map<string, { boardTitle: string; items: Row[] }>();
  for (const row of rows) {
    if (!row.board) continue;
    const key = row.board.id;
    if (!grouped.has(key)) grouped.set(key, { boardTitle: row.board.title, items: [] });
    grouped.get(key)!.items.push(row);
  }

  return (
    <div className="min-h-screen bg-vault-950">
      <TopNav email={auth.email} isAdmin={auth.user.role === 'ADMIN'} />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal-glow">
          Digital Library
        </p>
        <h1 className="mt-2 font-display text-2xl font-semibold text-ink">E-Books</h1>
        <p className="mt-2 max-w-xl text-sm text-ink-dim">
          Study guides and notes from every board you have access to, in one place.
        </p>

        {grouped.size === 0 ? (
          <div className="mt-10 rounded-xl border border-dashed border-vault-border p-10 text-center">
            <p className="text-sm text-ink-dim">No e-books have been published yet.</p>
          </div>
        ) : (
          Array.from(grouped.values()).map((group) => (
            <section key={group.boardTitle} className="mt-10">
              <p className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">
                {group.boardTitle}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
                {group.items.map((eb) => (
                  <EBookCard
                    key={eb.id}
                    title={eb.title}
                    thumbnailUrl={eb.thumbnail_url}
                    downloadUrl={eb.download_url}
                    format={eb.format}
                    price={Number(eb.price)}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </main>
    </div>
  );
}
