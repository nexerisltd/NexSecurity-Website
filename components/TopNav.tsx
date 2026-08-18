'use client';

import Link from 'next/link';
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
    <header className="sticky top-0 z-10 border-b border-vault-border bg-vault-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-4">
          {backHref ? (
            <Link
              href={backHref}
              className="font-mono text-xs uppercase tracking-widest text-ink-dim transition hover:text-ink"
            >
              ← Back
            </Link>
          ) : (
            <span className="font-display text-sm font-semibold tracking-tight text-ink">
              NexSecurity
            </span>
          )}
        </div>

        <div className="flex items-center gap-4">
          {isAdmin && (
            <Link
              href="/admin"
              className="rounded-md border border-vault-border px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-signal-glow transition hover:border-signal"
            >
              Admin
            </Link>
          )}
          <span className="hidden font-mono text-[11px] text-ink-faint sm:inline">
            {email}
          </span>
          <button
            onClick={handleLogout}
            className="rounded-md border border-vault-border px-3 py-1.5 text-xs text-ink-dim transition hover:border-danger/50 hover:text-danger"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
