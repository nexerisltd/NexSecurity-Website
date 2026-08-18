import Link from 'next/link';

export function PublicFooter() {
  return (
    <footer className="border-t border-vault-border bg-vault-950">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-md border border-signal/40 bg-signal/10">
                <span className="font-mono text-xs font-bold text-signal-glow">N</span>
              </span>
              <span className="font-display text-sm font-semibold text-ink">NexSecurity</span>
            </div>
            <p className="mt-3 max-w-xs text-sm text-ink-dim">
              A private, invite-only learning space. Every class, board, and file stays behind
              server-verified access — no public links, ever.
            </p>
          </div>

          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
              Platform
            </p>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link href="/#paths" className="text-ink-dim transition hover:text-ink">
                  Learning paths
                </Link>
              </li>
              <li>
                <Link href="/#reviews" className="text-ink-dim transition hover:text-ink">
                  Member reviews
                </Link>
              </li>
              <li>
                <Link href="/login" className="text-ink-dim transition hover:text-ink">
                  Member sign in
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
              Access
            </p>
            <p className="mt-3 max-w-xs text-sm text-ink-dim">
              Membership is by invitation. If you believe you should have access and can&apos;t
              sign in, contact your administrator directly.
            </p>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-start justify-between gap-3 border-t border-vault-border pt-6 text-xs text-ink-faint sm:flex-row sm:items-center">
          <span>© {new Date().getFullYear()} NexSecurity. All rights reserved.</span>
          <span className="font-mono uppercase tracking-widest">Private by default</span>
        </div>
      </div>
    </footer>
  );
}
