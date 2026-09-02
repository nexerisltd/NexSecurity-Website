import Link from 'next/link';
import Image from 'next/image';

export function PublicNav({ isMember = false }: { isMember?: boolean }) {
  return (
    <header className="relative z-20 border-b border-vault-border bg-vault-900/60 backdrop-blur-2xl backdrop-saturate-150">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="relative h-8 w-8 overflow-hidden rounded-lg border border-vault-border bg-vault-800 shadow-glass">
            <Image src="/logo.png" alt="NexSecurity" fill className="object-cover" />
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

        {isMember ? (
          <Link
            href="/learn"
            className="rounded-full bg-signal px-4 py-2 text-sm font-medium text-white shadow-glow transition hover:bg-signal-glow"
          >
            Learn
          </Link>
        ) : (
          <Link
            href="/login"
            className="rounded-full bg-signal px-4 py-2 text-sm font-medium text-white shadow-glow transition hover:bg-signal-glow"
          >
            Member sign in
          </Link>
        )}
      </div>
    </header>
  );
}
