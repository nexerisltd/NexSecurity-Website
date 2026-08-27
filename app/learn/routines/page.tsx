import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import Image from 'next/image';
import { TopNav } from '@/components/TopNav';

export const dynamic = 'force-dynamic';

export default async function RoutinesPage() {
  const auth = await getAuth();
  if (auth.state === 'UNAUTHENTICATED') redirect('/login');
  if (auth.state === 'UNAUTHORIZED') redirect('/login?error=access_denied');
  if (auth.state === 'DEVICE_BLOCKED') redirect('/login?error=device_blocked');

  // boards IS directly readable by any authorized user for published rows
  // (see boards_select_authorized in supabase/schema.sql) — no admin
  // client needed here, unlike videos/e_books.
  const supabase = createSupabaseServerClient();
  const { data: routines } = await supabase
    .from('boards')
    .select('id, title, description, routine_image_url')
    .eq('board_type', 'routine')
    .eq('published', true)
    .order('sort_order', { ascending: true });

  return (
    <div className="min-h-screen bg-vault-950">
      <TopNav email={auth.email} isAdmin={auth.user.role === 'ADMIN'} profile={auth.profile} />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal-glow">
          Schedules
        </p>
        <h1 className="mt-2 font-display text-2xl font-semibold text-ink">Routines</h1>
        <p className="mt-2 max-w-xl text-sm text-ink-dim">
          Class routines and timetables, kept up to date by your administrator.
        </p>

        {!routines || routines.length === 0 ? (
          <div className="mt-10 rounded-xl border border-dashed border-vault-border p-10 text-center">
            <p className="text-sm text-ink-dim">No routines have been published yet.</p>
          </div>
        ) : (
          <div className="mt-8 space-y-8">
            {routines.map((r) => (
              <div key={r.id} className="glass-panel overflow-hidden rounded-2xl">
                <div className="border-b border-white/50 px-6 py-4">
                  <h2 className="font-display text-base font-semibold text-ink">{r.title}</h2>
                  {r.description && <p className="mt-1 text-sm text-ink-dim">{r.description}</p>}
                </div>
                <div className="relative aspect-video w-full bg-vault-800">
                  {r.routine_image_url ? (
                    <Image
                      src={r.routine_image_url}
                      alt={r.title}
                      fill
                      sizes="(min-width: 1024px) 896px, 100vw"
                      className="object-contain"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-faint">
                        Not uploaded yet
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
