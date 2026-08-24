'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

type NavItem = { href: string; label: string; icon: JSX.Element; match: (path: string) => boolean };

const ICONS = {
  home: (
    <path
      d="M4 11.5 12 4l8 7.5M6 9.5V20h12V9.5"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  learn: (
    <path
      d="m12 4 9 4-9 4-9-4 9-4Zm-6 6.2V16c0 1.1 2.7 3 6 3s6-1.9 6-3v-5.8"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  ebook: (
    <path
      d="M4 5.5C5.2 4.9 7 4.5 9 4.5c1.7 0 3.3.3 4 .8v13.2c-.7-.5-2.3-.8-4-.8-2 0-3.8.4-5 1V5.5Zm18 0c-1.2-.6-3-1-5-1-1.7 0-3.3.3-4 .8v13.2c.7-.5 2.3-.8 4-.8 2 0 3.8.4 5 1V5.5Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  routine: (
    <path
      d="M7 3v3.5M17 3v3.5M4 9.5h16M5.5 5.5h13a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19V7a1.5 1.5 0 0 1 1.5-1.5Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  admin: (
    <path
      d="M12 3.5 5 6v5.4c0 4.4 2.9 7.7 7 9.1 4.1-1.4 7-4.7 7-9.1V6l-7-2.5Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
};

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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const items: NavItem[] = [
    { href: '/', label: 'Home', icon: ICONS.home, match: (p) => p === '/' },
    {
      href: '/learn',
      label: 'Learn',
      icon: ICONS.learn,
      match: (p) => p === '/learn' || p.startsWith('/learn/board') || p.startsWith('/learn/video'),
    },
    { href: '/learn/ebooks', label: 'E-Book', icon: ICONS.ebook, match: (p) => p.startsWith('/learn/ebooks') },
    {
      href: '/learn/routines',
      label: 'Routine',
      icon: ICONS.routine,
      match: (p) => p.startsWith('/learn/routines'),
    },
    ...(isAdmin
      ? [{ href: '/admin', label: 'Admin', icon: ICONS.admin, match: (p: string) => p.startsWith('/admin') }]
      : []),
  ];

  const activeHref = items.find((i) => i.match(pathname))?.href ?? items[0].href;

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  // No display-name field in the schema — derive a readable name from the
  // email's local part (e.g. "arabi.islam" -> "Arabi Islam") rather than
  // showing the raw address in the header.
  const displayName = email
    .split('@')[0]
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const initials = displayName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

  return (
    <header className="sticky top-0 z-30 border-b border-white/60 bg-white/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
        <div className="flex shrink-0 items-center gap-2">
          {backHref && (
            <Link
              href={backHref}
              title="Back"
              className="flex h-7 w-7 items-center justify-center rounded-full text-ink-dim transition hover:bg-vault-600 hover:text-ink"
            >
              ←
            </Link>
          )}
          <Link href="/" className="flex items-center gap-2.5">
            <span className="relative h-8 w-8 overflow-hidden rounded-lg border border-white/70 bg-white/70 shadow-glass">
              <Image src="/logo.png" alt="NexSecurity" fill className="object-cover" />
            </span>
            <span className="font-display text-sm font-semibold tracking-tight text-ink">NexSecurity</span>
          </Link>
        </div>

        <nav className="hidden items-center gap-1 md:flex">
          {items.map((item) => {
            const active = item.href === activeHref;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active ? 'bg-signal/10 text-signal' : 'text-ink-dim hover:bg-vault-600 hover:text-ink'
                }`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  {item.icon}
                </svg>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <div className="hidden items-center gap-2 rounded-lg border border-vault-border bg-white/60 px-3 py-2 text-ink-faint sm:flex">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
              <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <span className="text-xs">Search anything…</span>
            <kbd className="ml-4 rounded border border-vault-border bg-vault-600 px-1.5 py-0.5 text-[10px] font-medium">
              Ctrl K
            </kbd>
          </div>

          <button
            title="Notifications"
            className="flex h-9 w-9 items-center justify-center rounded-full text-ink-faint transition hover:bg-vault-600 hover:text-ink"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 9a6 6 0 1 1 12 0c0 4.2 1 5.5 1.5 6.2.3.4 0 .8-.5.8H5c-.5 0-.8-.4-.5-.8C5 14.5 6 13.2 6 9Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>

          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition hover:bg-vault-600"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-signal/15 text-xs font-semibold text-signal">
                {initials || '?'}
              </span>
              <span className="hidden text-left leading-tight sm:block">
                <span className="block text-xs font-semibold text-ink">{displayName}</span>
                <span className="block text-[11px] text-ink-faint">{isAdmin ? 'Admin' : 'Member'}</span>
              </span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-ink-faint">
                <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {menuOpen && (
              <div className="glass-panel-solid absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-xl py-1">
                <p className="truncate px-3.5 py-2 text-xs text-ink-faint" title={email}>
                  {email}
                </p>
                <button
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm text-ink-dim transition hover:bg-vault-600 hover:text-danger disabled:opacity-60"
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
                  {loggingOut ? 'Signing out…' : 'Sign out'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
