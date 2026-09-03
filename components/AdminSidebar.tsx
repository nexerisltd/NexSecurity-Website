'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  {
    href: '/admin',
    label: 'Overview',
    icon: (
      <path
        d="M4 11.5 12 4l8 7.5M6 9.5V20h12V9.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    href: '/admin/users',
    label: 'Users',
    icon: (
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
        <path d="M16 4.5c1.7.4 3 2 3 3.9s-1.3 3.5-3 3.9M21 20c0-2.8-2-5.1-4.7-5.8" />
      </g>
    ),
  },
  {
    href: '/admin/boards',
    label: 'Boards',
    icon: (
      <g stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
        <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
        <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
        <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
        <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
      </g>
    ),
  },
  {
    href: '/admin/access',
    label: 'Access',
    icon: (
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="10.5" width="14" height="9" rx="1.8" />
        <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      </g>
    ),
  },
  {
    href: '/admin/videos',
    label: 'Classes',
    icon: (
      <path
        d="m12 4 9 4-9 4-9-4 9-4Zm-6 6.2V16c0 1.1 2.7 3 6 3s6-1.9 6-3v-5.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    href: '/admin/ebooks',
    label: 'E-Books',
    icon: (
      <path
        d="M4 5.5C5.2 4.9 7 4.5 9 4.5c1.7 0 3.3.3 4 .8v13.2c-.7-.5-2.3-.8-4-.8-2 0-3.8.4-5 1V5.5Zm18 0c-1.2-.6-3-1-5-1-1.7 0-3.3.3-4 .8v13.2c.7-.5 2.3-.8 4-.8 2 0 3.8.4 5 1V5.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    href: '/admin/popup',
    label: 'Popup',
    icon: (
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="5" width="16" height="12" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </g>
    ),
  },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    // Below md: a horizontally-scrollable tab strip spanning full width
    // (matches how TopNav's own links behave at narrow widths) — never a
    // fixed-width column squeezed beside content, which is what forced
    // every admin page's text into a ~110px-wide sliver on a phone.
    // At md+: back to the original fixed-width vertical list.
    <nav className="glass-panel flex shrink-0 gap-1 overflow-x-auto no-scrollbar rounded-2xl p-2.5 md:h-fit md:w-52 md:flex-col md:space-y-1 md:overflow-visible">
      {ITEMS.map((item) => {
        const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium transition ${
              active ? 'bg-signal/10 text-signal' : 'text-ink-dim hover:bg-vault-700 hover:text-ink'
            }`}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" className="shrink-0" aria-hidden="true">
              {item.icon}
            </svg>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
