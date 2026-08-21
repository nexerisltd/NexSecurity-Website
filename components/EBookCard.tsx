export function EBookCard({
  title,
  thumbnailUrl,
  downloadUrl,
  format,
  price,
}: {
  title: string;
  thumbnailUrl?: string | null;
  downloadUrl?: string | null;
  format: string;
  price: number;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-vault-border bg-vault-900 transition hover:border-signal/60 hover:shadow-glow">
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-vault-800">
        {thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-scanlines">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-faint">
              No cover
            </span>
          </div>
        )}
        <span className="absolute right-2 top-2 rounded bg-vault-950/80 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-signal-glow">
          {format}
        </span>
      </div>
      <div className="p-4">
        <h3 className="font-display text-sm font-medium text-ink line-clamp-2">{title}</h3>
        <p className="mt-1 text-xs font-medium text-ok">{price > 0 ? `৳${price}` : 'Free'}</p>

        {downloadUrl ? (
          <a
            href={downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-signal px-4 py-2.5 text-sm font-medium text-white transition hover:bg-signal-glow"
          >
            <span aria-hidden>⬇</span>
            Download
          </a>
        ) : (
          <p className="mt-4 text-center text-xs text-ink-faint">No download link yet</p>
        )}
      </div>
    </div>
  );
}
