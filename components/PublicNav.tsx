import Link from 'next/link';
import Image from 'next/image';

export function PublicNav() {
  return (
    <header className="sticky top-0 z-20 border-b border-white/60 bg-white/55 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="relative h-8 w-8 overflow-hidden rounded-lg border border-white/70 bg-white/70 shadow-glass">
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

        <Link
          href="/login"
          className="rounded-full bg-signal px-4 py-2 text-sm font-medium text-white shadow-glow transition hover:bg-signal-glow"
        >
          Member sign in
        </Link>
      </div>
    </header>
  );
}
