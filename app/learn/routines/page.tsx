import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { filterAccessibleBoards } from '@/lib/boardAccess';
import { RoutineImageViewer } from '@/components/RoutineImageViewer';

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
  const { data: routineRows } = await supabase
    .from('boards')
    .select('id, title, description, routine_image_url, visibility')
    .eq('board_type', 'routine')
    .eq('published', true)
    .order('sort_order', { ascending: true });

  // Same 'restricted' visibility rule as every other board listing — a
  // routine board can be locked to specific users too.
  const adminClient = createSupabaseAdminClient();
  const routines = await filterAccessibleBoards(
    adminClient,
    auth.user.email,
    routineRows ?? [],
    auth.user.role === 'ADMIN'
  );

  return (
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
              <div className="flex items-start justify-between gap-4 border-b border-white/50 px-6 py-4">
                <div>
                  <h2 className="font-display text-base font-semibold text-ink">{r.title}</h2>
                  {r.description && <p className="mt-1 text-sm text-ink-dim">{r.description}</p>}
                </div>
                {r.routine_image_url && (
                  <a
                    href={`/api/routine/${r.id}/download`}
                    className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-signal px-3 py-1.5 text-xs font-medium text-white transition hover:bg-signal-glow"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
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
              <div className="relative aspect-video w-full bg-vault-800">
                {r.routine_image_url ? (
                  <RoutineImageViewer src={r.routine_image_url} alt={r.title} />
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
  );
}
