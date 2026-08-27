import Link from 'next/link';
import Image from 'next/image';

export function BoardCard({
  href,
  title,
  description,
  thumbnailUrl,
}: {
  href: string;
  title: string;
  description?: string | null;
  thumbnailUrl?: string | null;
}) {
  return (
    <Link
      href={href}
      className="group relative block overflow-hidden rounded-xl border border-vault-border bg-vault-900 transition hover:border-signal/60 hover:shadow-glow backdrop-blur-xl shadow-glass"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-vault-800">
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
        <div className="absolute inset-0 bg-gradient-to-t from-vault-950/80 via-transparent to-transparent opacity-0 transition group-hover:opacity-100" />
      </div>
      <div className="p-4">
        <h3 className="font-display text-sm font-medium text-ink line-clamp-1">{title}</h3>
        {description && (
          <p className="mt-1 text-xs text-ink-dim line-clamp-2">{description}</p>
        )}
      </div>
    </Link>
  );
}
