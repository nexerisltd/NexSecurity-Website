'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export function TopNav({
  email,
  isAdmin,
  backHref,
}: {
  email: string;
  isAdmin: boolean;
  backHref?: string;
}) {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-10 border-b border-white/60 bg-white/55 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
        <div className="flex items-center gap-4">
          {backHref ? (
            <Link
              href={backHref}
              className="font-mono text-xs uppercase tracking-widest text-ink-dim transition hover:text-ink"
            >
              ← Back
            </Link>
          ) : (
            <Link href="/learn" className="flex items-center gap-2.5">
              <span className="relative h-8 w-8 overflow-hidden rounded-lg border border-white/70 bg-white/70 shadow-glass">
                <Image src="/logo.png" alt="NexSecurity" fill className="object-cover" />
              </span>
              <span className="font-display text-sm font-semibold tracking-tight text-ink">
                NexSecurity
              </span>
            </Link>
          )}
        </div>

        <div className="flex items-center gap-3">
          {isAdmin && (
            <Link
              href="/admin"
              className="rounded-full border border-vault-border bg-white/50 px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-widest text-signal backdrop-blur-sm transition hover:border-signal hover:bg-white/80"
            >
              Admin
            </Link>
          )}
          <span className="hidden font-mono text-[11px] text-ink-faint sm:inline">
            {email}
          </span>
          <button
            onClick={handleLogout}
            className="rounded-full border border-vault-border bg-white/50 px-3.5 py-1.5 text-xs text-ink-dim backdrop-blur-sm transition hover:border-danger/40 hover:text-danger"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
