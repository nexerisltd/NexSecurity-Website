'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

type NavItem = { href: string; label: string; match: (path: string) => boolean };

export function TopNav({
  email,
  isAdmin,
  backHref,
}: {
  email: string;
  isAdmin: boolean;
  /** Optional small back-chevron shown to the left of the logo (e.g. a
   * board or video page linking back to its parent). The nav items
   * themselves are always shown — this never replaces them. */
  backHref?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  const items: NavItem[] = [
    { href: '/', label: 'Home', match: (p) => p === '/' },
    {
      href: '/learn',
      label: 'Learn',
      match: (p) => p === '/learn' || p.startsWith('/learn/board') || p.startsWith('/learn/video'),
    },
    { href: '/learn/ebooks', label: 'E-Book', match: (p) => p.startsWith('/learn/ebooks') },
    { href: '/learn/routines', label: 'Routine', match: (p) => p.startsWith('/learn/routines') },
    ...(isAdmin ? [{ href: '/admin', label: 'Admin', match: (p: string) => p.startsWith('/admin') }] : []),
  ];

  const activeHref = items.find((i) => i.match(pathname))?.href ?? items[0].href;

  const railRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  function measure() {
    const el = itemRefs.current.get(activeHref);
    const rail = railRef.current;
    if (!el || !rail) return;
    const elRect = el.getBoundingClientRect();
    const railRect = rail.getBoundingClientRect();
    setIndicator({ left: elRect.left - railRect.left, width: elRect.width });
  }

  useLayoutEffect(() => {
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHref]);

  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHref]);

  async function handleLogout() {
    setLoggingOut(true);
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="sticky top-4 z-30 flex justify-center px-4">
      <div className="glass-panel flex w-full max-w-3xl items-center gap-1 rounded-full p-1.5">
        {backHref && (
          <Link
            href={backHref}
            title="Back"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-dim transition hover:bg-white/70 hover:text-ink"
          >
            ←
          </Link>
        )}

        <Link href="/learn" className="flex shrink-0 items-center gap-2 pl-1.5 pr-2">
          <span className="relative h-7 w-7 overflow-hidden rounded-full border border-white/70 bg-white/70">
            <Image src="/logo.png" alt="NexSecurity" fill className="object-cover" />
          </span>
        </Link>

        <div ref={railRef} className="relative flex flex-1 items-center gap-0.5 overflow-x-auto">
          {indicator && (
            <div
              className="absolute top-0 h-full rounded-full border border-signal/30 bg-signal/10 transition-[left,width] duration-300 ease-out"
              style={{ left: indicator.left, width: indicator.width }}
            />
          )}
          {items.map((item) => {
            const active = item.href === activeHref;
            return (
              <Link
                key={item.href}
                href={item.href}
                ref={(el) => {
                  if (el) itemRefs.current.set(item.href, el);
                }}
                className={`relative z-10 shrink-0 whitespace-nowrap rounded-full px-3.5 py-2 text-xs font-medium transition ${
                  active ? 'text-signal' : 'text-ink-dim hover:text-ink'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>

        <button
          onClick={handleLogout}
          disabled={loggingOut}
          title={`Sign out (${email})`}
          className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-vault-border bg-white/60 text-ink-faint transition hover:border-danger/40 hover:text-danger disabled:opacity-60"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
