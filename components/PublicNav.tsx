import Link from 'next/link';

export function PublicNav() {
  return (
    <header className="sticky top-0 z-20 border-b border-vault-border bg-vault-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md border border-signal/40 bg-signal/10">
            <span className="font-mono text-xs font-bold text-signal-glow">N</span>
          </span>
          <span className="font-display text-sm font-semibold tracking-tight text-ink">
            NexSecurity
          </span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          <Link href="/#paths" className="text-sm text-ink-dim transition hover:text-ink">
            Learning paths
          </Link>
          <Link href="/#reviews" className="text-sm text-ink-dim transition hover:text-ink">
            Reviews
          </Link>
          <Link href="/#faq" className="text-sm text-ink-dim transition hover:text-ink">
            FAQ
          </Link>
        </nav>

        <Link
          href="/login"
          className="rounded-md bg-signal px-4 py-2 text-sm font-medium text-white transition hover:bg-signal-glow"
        >
          Member sign in
        </Link>
      </div>
    </header>
  );
}
