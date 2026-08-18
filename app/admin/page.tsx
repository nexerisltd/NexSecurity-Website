import { createSupabaseServerClient } from '@/lib/supabase/server';

export default async function AdminOverview() {
  const supabase = createSupabaseServerClient();

  const [{ count: userCount }, { count: boardCount }] = await Promise.all([
    supabase.from('authorized_users').select('*', { count: 'exact', head: true }),
    supabase.from('boards').select('*', { count: 'exact', head: true }),
  ]);

  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal-glow">Admin</p>
      <h1 className="mt-2 font-display text-2xl font-semibold text-ink">Overview</h1>

      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label="Authorized users" value={userCount ?? 0} />
        <StatCard label="Boards" value={boardCount ?? 0} />
      </div>

      <div className="mt-10 rounded-xl border border-vault-border bg-vault-900 p-6">
        <p className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">
          Reminder
        </p>
        <p className="mt-2 text-sm text-ink-dim">
          Every admin mutation below runs through server-side role checks and Postgres RLS —
          no admin action is ever gated by frontend state alone.
        </p>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-vault-border bg-vault-900 p-5">
      <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">{label}</p>
      <p className="mt-2 font-display text-3xl font-semibold text-ink">{value}</p>
    </div>
  );
}
