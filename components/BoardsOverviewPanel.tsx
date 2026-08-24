import Link from 'next/link';

export type OverviewBoard = { id: string; title: string; classCount: number; icon: number };
export type OverviewActivity = { videoId: string; title: string; category: string; timeAgo: string; icon: number };

// Four-color icon palette, cycled by index — mirrors the reference design's
// per-subject color coding. Boards don't have a stored color/icon in the
// schema, so this is assigned positionally rather than per-subject-meaning.
const PALETTE = [
  { bg: 'bg-signal/10', fg: 'text-signal' }, // blue
  { bg: 'bg-ok/10', fg: 'text-ok' }, // green
  { bg: 'bg-violet-500/10', fg: 'text-violet-600' }, // purple
  { bg: 'bg-warn/10', fg: 'text-warn' }, // amber/orange
];

const ICON_PATHS = [
  // code brackets — matches PALETTE[0]
  <path
    key="code"
    d="m9 8-4 4 4 4M15 8l4 4-4 4"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  />,
  // shield — matches PALETTE[1]
  <path
    key="shield"
    d="M12 3.5 5 6v5.4c0 4.4 2.9 7.7 7 9.1 4.1-1.4 7-4.7 7-9.1V6l-7-2.5Z"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  />,
  // database — matches PALETTE[2]
  <g key="db" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="6" rx="7" ry="2.5" />
    <path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6" />
    <path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
  </g>,
  // palette — matches PALETTE[3]
  <path
    key="palette"
    d="M12 3.5a8.5 8.5 0 1 0 0 17c1 0 1.6-.7 1.6-1.6 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6H16a4.5 4.5 0 0 0 4.5-4.5c0-4-4-7.1-8.5-7.1Z M7.5 12a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm2.5-4a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm5 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm2.5 4a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
    stroke="currentColor"
    strokeWidth="1.3"
    strokeLinecap="round"
    strokeLinejoin="round"
  />,
];

function IconBadge({ index }: { index: number }) {
  const color = PALETTE[index % PALETTE.length];
  return (
    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${color.bg} ${color.fg}`}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {ICON_PATHS[index % ICON_PATHS.length]}
      </svg>
    </span>
  );
}

export function BoardsOverviewPanel({
  boards,
  activity,
}: {
  boards: OverviewBoard[];
  activity: OverviewActivity[];
}) {
  return (
    <div className="glass-panel-solid rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
          </svg>
          All Boards
        </div>
        <span className="text-xs font-medium text-ink-faint">Recent Activity</span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3.5 sm:grid-cols-2">
        <div className="space-y-3.5">
          {boards.length === 0 ? (
            <p className="text-xs text-ink-faint">No boards published yet.</p>
          ) : (
            boards.map((b) => (
              <Link key={b.id} href={`/learn/board/${b.id}`} className="flex items-center gap-3 group">
                <IconBadge index={b.icon} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink group-hover:text-signal">
                    {b.title}
                  </span>
                  <span className="block text-xs text-ink-faint">
                    {b.classCount} {b.classCount === 1 ? 'class' : 'classes'}
                  </span>
                </span>
              </Link>
            ))
          )}
        </div>

        <div className="space-y-3.5">
          {activity.length === 0 ? (
            <p className="text-xs text-ink-faint">No activity yet.</p>
          ) : (
            activity.map((a) => (
              <Link key={a.videoId} href={`/learn/video/${a.videoId}`} className="flex items-center gap-3 group">
                <IconBadge index={a.icon} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink group-hover:text-signal">
                    {a.title}
                  </span>
                  <span className="block truncate text-xs text-ink-faint">{a.category}</span>
                </span>
                <span className="shrink-0 text-[11px] text-ink-faint">{a.timeAgo}</span>
              </Link>
            ))
          )}
        </div>
      </div>

      <div className="mt-4 border-t border-vault-border pt-3.5 text-center">
        <Link href="/learn" className="text-xs font-medium text-signal hover:underline">
          View all boards →
        </Link>
      </div>
    </div>
  );
}
