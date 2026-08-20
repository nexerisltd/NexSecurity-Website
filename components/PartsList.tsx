import Link from 'next/link';

type Part = {
  id: string;
  title: string;
  thumbnail_url: string | null;
  sort_order: number;
};

export function PartsList({ parts, activeId }: { parts: Part[]; activeId: string }) {
  return (
    <div className="space-y-2">
      {parts.map((part, index) => {
        const isActive = part.id === activeId;
        return (
          <Link
            key={part.id}
            href={`/learn/video/${part.id}`}
            className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition ${
              isActive
                ? 'border-signal bg-signal/10'
                : 'border-vault-border bg-vault-900 hover:border-signal/50'
            }`}
          >
            <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded-md bg-vault-800">
              {part.thumbnail_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={part.thumbnail_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <span className="font-mono text-[9px] text-ink-faint">#{index + 1}</span>
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p
                className={`truncate text-sm ${isActive ? 'text-signal-glow' : 'text-ink'}`}
              >
                {part.title}
              </p>
              <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
                Part {index + 1}
              </p>
            </div>
            {isActive && (
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-signal-glow">
                Now playing
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
