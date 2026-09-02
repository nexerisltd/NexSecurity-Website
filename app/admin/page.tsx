import Link from 'next/link';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LineChart } from '@/components/LineChart';
import { relativeTime } from '@/lib/relativeTime';

export const dynamic = 'force-dynamic';

const DAY_MS = 86_400_000;

function dayLabel(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Buckets a list of ISO timestamps into counts-per-day for the last 7 days. */
function bucketByDay(timestamps: string[], days: Date[]): number[] {
  const counts = days.map(() => 0);
  for (const ts of timestamps) {
    const t = new Date(ts);
    for (let i = 0; i < days.length; i++) {
      const dayStart = days[i];
      const dayEnd = new Date(dayStart.getTime() + DAY_MS);
      if (t >= dayStart && t < dayEnd) {
        counts[i]++;
        break;
      }
    }
  }
  return counts;
}

type AuditRow = {
  event_type: string;
  actor_email: string | null;
  target: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

const EVENT_ICONS: Record<string, JSX.Element> = {
  user: (
    <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5" />
    </g>
  ),
  board: (
    <g stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.3" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.3" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.3" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.3" />
    </g>
  ),
  class: (
    <path
      d="m12 4 9 4-9 4-9-4 9-4Zm-6 6.2V16c0 1.1 2.7 3 6 3s6-1.9 6-3v-5.8"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  ebook: (
    <path
      d="M4 5.5C5.2 4.9 7 4.5 9 4.5c1.7 0 3.3.3 4 .8v13.2c-.7-.5-2.3-.8-4-.8-2 0-3.8.4-5 1V5.5Zm18 0c-1.2-.6-3-1-5-1-1.7 0-3.3.3-4 .8v13.2c.7-.5 2.3-.8 4-.8 2 0 3.8.4 5 1V5.5Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  role: (
    <path
      d="M12 3.5 5 6v5.4c0 4.4 2.9 7.7 7 9.1 4.1-1.4 7-4.7 7-9.1V6l-7-2.5Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
};

/** Maps a raw audit_logs row to what the Recent Activity list shows.
 * Returns null for event types that are too noisy/uninteresting for this
 * feed (logins, per-student video access) so they're filtered out. */
function describeEvent(row: AuditRow): { label: string; detail: string; icon: JSX.Element; color: string } | null {
  const action = typeof row.metadata?.action === 'string' ? row.metadata.action : null;
  const title = typeof row.metadata?.title === 'string' ? row.metadata.title : row.target ?? '';

  switch (row.event_type) {
    case 'USER_ADDED':
      return { label: 'New user registered', detail: row.target ?? '', icon: EVENT_ICONS.user, color: 'bg-ok/10 text-ok' };
    case 'USER_REMOVED':
      return { label: 'User removed', detail: row.target ?? '', icon: EVENT_ICONS.user, color: 'bg-danger/10 text-danger' };
    case 'USER_DISABLED':
      return { label: 'User disabled', detail: row.target ?? '', icon: EVENT_ICONS.user, color: 'bg-warn/10 text-warn' };
    case 'USER_ENABLED':
      return { label: 'User enabled', detail: row.target ?? '', icon: EVENT_ICONS.user, color: 'bg-ok/10 text-ok' };
    case 'USER_ROLE_CHANGED':
      return { label: 'User role updated', detail: row.target ?? '', icon: EVENT_ICONS.role, color: 'bg-danger/10 text-danger' };
    case 'BOARD_CREATED':
      return { label: 'Board created', detail: title, icon: EVENT_ICONS.board, color: 'bg-signal/10 text-signal' };
    case 'BOARD_DELETED':
      return { label: 'Board deleted', detail: row.target ?? '', icon: EVENT_ICONS.board, color: 'bg-danger/10 text-danger' };
    case 'ADMIN_ACTION':
      if (action === 'VIDEO_CREATED') return { label: 'New class added', detail: title, icon: EVENT_ICONS.class, color: 'bg-ok/10 text-ok' };
      if (action === 'EBOOK_CREATED') return { label: 'E-Book uploaded', detail: title, icon: EVENT_ICONS.ebook, color: 'bg-warn/10 text-warn' };
      if (action === 'VIDEO_DELETED') return { label: 'Class removed', detail: title, icon: EVENT_ICONS.class, color: 'bg-danger/10 text-danger' };
      if (action === 'EBOOK_DELETED') return { label: 'E-Book removed', detail: title, icon: EVENT_ICONS.ebook, color: 'bg-danger/10 text-danger' };
      if (action === 'AUTO_RESTRICT_ENABLED')
        return {
          label: 'Device restriction auto-enabled',
          detail: `${row.target ?? 'unknown user'} — first device registered`,
          icon: EVENT_ICONS.role,
          color: 'bg-warn/10 text-warn',
        };
      return null;
    default:
      return null;
  }
}

export default async function AdminOverview() {
  const admin = createSupabaseAdminClient();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (6 - i));
    return d;
  });

  const [
    { count: userCount },
    { count: userWeekCount },
    { count: boardCount },
    { count: boardWeekCount },
    { count: classCount },
    { count: classWeekCount },
    { count: ebookCount },
    { count: ebookWeekCount },
    { data: recentUsersRaw },
    { data: auditRowsRaw },
    { data: userTimestamps },
    { data: boardTimestamps },
    { data: classTimestamps },
    { data: ebookTimestamps },
  ] = await Promise.all([
    admin.from('authorized_users').select('id', { count: 'exact', head: true }),
    admin.from('authorized_users').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
    admin.from('boards').select('id', { count: 'exact', head: true }),
    admin.from('boards').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
    admin.from('videos').select('id', { count: 'exact', head: true }),
    admin.from('videos').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
    admin.from('e_books').select('id', { count: 'exact', head: true }),
    admin.from('e_books').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
    admin.from('authorized_users').select('id, email, role, status, created_at').order('created_at', { ascending: false }).limit(5),
    admin.from('audit_logs').select('event_type, actor_email, target, metadata, created_at').order('created_at', { ascending: false }).limit(30),
    admin.from('authorized_users').select('created_at').gte('created_at', days[0].toISOString()),
    admin.from('boards').select('created_at').gte('created_at', days[0].toISOString()),
    admin.from('videos').select('created_at').gte('created_at', days[0].toISOString()),
    admin.from('e_books').select('created_at').gte('created_at', days[0].toISOString()),
  ]);

  const stats = [
    { label: 'Users', value: userCount ?? 0, delta: userWeekCount ?? 0, icon: 'user', bg: 'bg-signal/10', fg: 'text-signal' },
    { label: 'Boards', value: boardCount ?? 0, delta: boardWeekCount ?? 0, icon: 'board', bg: 'bg-violet-500/10', fg: 'text-violet-400' },
    { label: 'Classes', value: classCount ?? 0, delta: classWeekCount ?? 0, icon: 'class', bg: 'bg-ok/10', fg: 'text-ok' },
    { label: 'E-Books', value: ebookCount ?? 0, delta: ebookWeekCount ?? 0, icon: 'ebook', bg: 'bg-warn/10', fg: 'text-warn' },
  ];

  const signupPoints = bucketByDay((userTimestamps ?? []).map((r) => r.created_at), days);
  const contentPoints = bucketByDay(
    [
      ...(boardTimestamps ?? []).map((r) => r.created_at),
      ...(classTimestamps ?? []).map((r) => r.created_at),
      ...(ebookTimestamps ?? []).map((r) => r.created_at),
    ],
    days
  );

  const activity = ((auditRowsRaw ?? []) as AuditRow[])
    .map((row) => ({ row, described: describeEvent(row) }))
    .filter((r) => r.described !== null)
    .slice(0, 6);

  const recentUsers = recentUsersRaw ?? [];

  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal-glow">Admin</p>
      <h1 className="mt-2 font-display text-2xl font-semibold text-ink">Overview</h1>
      <p className="mt-1 text-sm text-ink-dim">Here&apos;s what&apos;s happening with your platform.</p>

      <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-vault-border bg-vault-900 p-5 backdrop-blur-xl shadow-glass">
            <span className={`flex h-10 w-10 items-center justify-center rounded-full ${s.bg} ${s.fg}`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                {EVENT_ICONS[s.icon]}
              </svg>
            </span>
            <p className="mt-3 text-xs text-ink-faint">{s.label}</p>
            <p className="font-display text-2xl font-semibold text-ink">{s.value}</p>
            {s.delta > 0 && (
              <p className="mt-0.5 text-xs text-ok">
                ↑ {s.delta} this week
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="rounded-xl border border-vault-border bg-vault-900 p-5 backdrop-blur-xl shadow-glass">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-ink">Platform Activity</p>
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5 text-ink-dim">
                <span className="h-2 w-2 rounded-full bg-signal" /> New Signups
              </span>
              <span className="flex items-center gap-1.5 text-ink-dim">
                <span className="h-2 w-2 rounded-full bg-ok" /> Content Added
              </span>
            </div>
          </div>
          <p className="mt-0.5 text-[11px] text-ink-faint">
            No page-view analytics are tracked yet, so this shows real signup and content-publishing
            activity instead.
          </p>
          <div className="mt-4">
            <LineChart
              xLabels={days.map(dayLabel)}
              series={[
                { label: 'New Signups', color: '#3d6eff', points: signupPoints },
                { label: 'Content Added', color: '#16a34a', points: contentPoints },
              ]}
            />
          </div>
        </div>

        <div className="rounded-xl border border-vault-border bg-vault-900 p-5 backdrop-blur-xl shadow-glass">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-ink">Recent Activity</p>
          </div>
          <div className="mt-4 space-y-4">
            {activity.length === 0 ? (
              <p className="text-xs text-ink-faint">Nothing yet.</p>
            ) : (
              activity.map(({ row, described }, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${described!.color}`}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      {described!.icon}
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink">{described!.label}</span>
                    {described!.detail && <span className="block truncate text-xs text-ink-faint">{described!.detail}</span>}
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-faint">{relativeTime(row.created_at)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="rounded-xl border border-vault-border bg-vault-900 p-5 backdrop-blur-xl shadow-glass">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-ink">Recently Added Users</p>
            <Link href="/admin/users" className="text-xs font-medium text-signal hover:underline">
              View all
            </Link>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-vault-border text-[10px] uppercase tracking-widest text-ink-faint">
                  <th className="pb-2 pr-4 font-medium">Email</th>
                  <th className="pb-2 pr-4 font-medium">Role</th>
                  <th className="pb-2 pr-4 font-medium">Joined</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentUsers.map((u) => (
                  <tr key={u.id} className="border-b border-vault-border/60 last:border-0">
                    <td className="py-2.5 pr-4 text-ink">{u.email}</td>
                    <td className="py-2.5 pr-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          u.role === 'ADMIN' ? 'bg-signal/10 text-signal' : 'bg-vault-600 text-ink-dim'
                        }`}
                      >
                        {u.role === 'ADMIN' ? 'Admin' : 'User'}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-ink-faint">
                      {new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          u.status === 'ACTIVE' ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger'
                        }`}
                      >
                        {u.status === 'ACTIVE' ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-vault-border bg-vault-900 p-5 backdrop-blur-xl shadow-glass">
          <p className="text-sm font-semibold text-ink">Quick Actions</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <QuickAction href="/admin/users" label="Add New User" icon={EVENT_ICONS.user} bg="bg-signal/10" fg="text-signal" />
            <QuickAction href="/admin/requests" label="Device Requests" icon={EVENT_ICONS.role} bg="bg-danger/10" fg="text-danger" />
            <QuickAction href="/admin/boards" label="Create Board" icon={EVENT_ICONS.board} bg="bg-violet-500/10" fg="text-violet-400" />
            <QuickAction href="/admin/videos" label="Add Class" icon={EVENT_ICONS.class} bg="bg-ok/10" fg="text-ok" />
            <QuickAction href="/admin/ebooks" label="Upload E-Book" icon={EVENT_ICONS.ebook} bg="bg-warn/10" fg="text-warn" />
          </div>
        </div>
      </div>
    </div>
  );
}

function QuickAction({
  href,
  label,
  icon,
  bg,
  fg,
}: {
  href: string;
  label: string;
  icon: JSX.Element;
  bg: string;
  fg: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 rounded-lg border border-vault-border p-3 text-sm font-medium text-ink transition hover:border-signal/50 hover:bg-vault-600"
    >
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${bg} ${fg}`}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          {icon}
        </svg>
      </span>
      {label}
    </Link>
  );
}
