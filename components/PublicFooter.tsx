import Link from 'next/link';
import Image from 'next/image';

export function PublicFooter() {
  return (
    <footer className="border-t border-vault-border bg-vault-900/40 backdrop-blur-2xl backdrop-saturate-150">
      <div className="mx-auto max-w-screen-2xl px-6 py-12">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <div className="flex items-center gap-2.5">
              <span className="relative h-8 w-8 overflow-hidden rounded-lg border border-vault-border bg-vault-800 shadow-glass">
                <Image src="/logo.png" alt="NexSecurity" fill className="object-cover" />
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
              Legal
            </p>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link href="/privacy" className="text-ink-dim transition hover:text-ink">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/terms" className="text-ink-dim transition hover:text-ink">
                  Terms & Conditions
                </Link>
              </li>
            </ul>
            <p className="mt-4 max-w-xs text-sm text-ink-dim">
              Membership is by invitation. If you believe you should have access and can&apos;t
              sign in, contact your administrator.
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
