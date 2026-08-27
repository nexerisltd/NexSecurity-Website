import Link from 'next/link';
import Image from 'next/image';

export function VideoCard({
  href,
  partLabel,
  title,
  description,
  thumbnailUrl,
  resourceLabels,
}: {
  href: string;
  partLabel: string;
  title: string;
  description?: string | null;
  thumbnailUrl?: string | null;
  resourceLabels?: string[];
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-vault-border bg-vault-900 transition hover:border-signal/60 hover:shadow-glow backdrop-blur-xl shadow-glass">
      <Link href={href} className="group relative block aspect-video w-full overflow-hidden bg-vault-800">
        {thumbnailUrl ? (
          <Image
            src={thumbnailUrl}
            alt=""
            fill
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-scanlines">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-faint">
              No preview
            </span>
          </div>
        )}
        <span className="absolute left-2 top-2 rounded bg-vault-950/80 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-signal-glow">
          {partLabel}
        </span>
      </Link>
      <div className="p-4">
        <h3 className="font-display text-sm font-medium text-ink line-clamp-1">{title}</h3>
        {description && <p className="mt-1 text-xs text-ink-dim line-clamp-2">{description}</p>}

        {resourceLabels && resourceLabels.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {resourceLabels.map((label) => (
              <span
                key={label}
                className="rounded-full border border-vault-border px-2 py-0.5 font-mono text-[10px] text-ink-dim"
              >
                📄 {label}
              </span>
            ))}
          </div>
        )}

        <Link
          href={href}
          className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-signal px-4 py-2.5 text-sm font-medium text-white transition hover:bg-signal-glow"
        >
          <span aria-hidden>▶</span>
          Watch Now
        </Link>
      </div>
    </div>
  );
}
