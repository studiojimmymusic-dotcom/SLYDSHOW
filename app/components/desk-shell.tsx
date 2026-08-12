'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

function IconImage() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="8.5" cy="9.5" r="1.5" fill="currentColor" />
      <path d="M21 16l-5.5-5.5L7 19" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
    </svg>
  );
}

function IconPosts() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M19.4 13.5a1.2 1.2 0 0 0 .24 1.32l.06.06a1.5 1.5 0 1 1-2.12 2.12l-.06-.06a1.2 1.2 0 0 0-1.32-.24 1.2 1.2 0 0 0-.72 1.1V18a1.5 1.5 0 1 1-3 0v-.1a1.2 1.2 0 0 0-.72-1.1 1.2 1.2 0 0 0-1.32.24l-.06.06a1.5 1.5 0 1 1-2.12-2.12l.06-.06a1.2 1.2 0 0 0 .24-1.32 1.2 1.2 0 0 0-1.1-.72H6a1.5 1.5 0 1 1 0-3h.1a1.2 1.2 0 0 0 1.1-.72 1.2 1.2 0 0 0-.24-1.32l-.06-.06a1.5 1.5 0 1 1 2.12-2.12l.06.06a1.2 1.2 0 0 0 1.32.24h.01A1.2 1.2 0 0 0 11.1 6.1V6a1.5 1.5 0 1 1 3 0v.1a1.2 1.2 0 0 0 .72 1.1h.01a1.2 1.2 0 0 0 1.32-.24l.06-.06a1.5 1.5 0 1 1 2.12 2.12l-.06.06a1.2 1.2 0 0 0-.24 1.32v.01a1.2 1.2 0 0 0 1.1.72H18a1.5 1.5 0 1 1 0 3h-.1a1.2 1.2 0 0 0-1.1.72Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const NAV = [
  { href: '/', label: 'Studio', icon: IconImage },
  { href: '/posts', label: 'Posts', icon: IconPosts },
  { href: '/settings', label: 'Settings', icon: IconSettings },
];

export function DeskShell({
  children,
  footer,
  headerLeft,
  headerRight,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
  headerLeft?: React.ReactNode;
  headerRight?: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-screen bg-surface font-sans text-text-primary">
      <aside className="flex w-[248px] shrink-0 flex-col border-r border-border bg-background">
        <div className="flex h-16 shrink-0 items-center px-5">
          <Link href="/" className="font-display text-lg font-medium tracking-tight text-text-primary">
            SLYDSHOW
          </Link>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 px-3 pt-1">
          {NAV.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  active
                    ? 'flex items-center gap-3 rounded-md bg-accent-tint px-3 py-2.5 text-[14px] font-medium text-text-primary'
                    : 'flex items-center gap-3 rounded-md px-3 py-2.5 text-[14px] font-medium text-text-secondary transition-colors hover:bg-surface hover:text-text-primary'
                }
              >
                <span className={active ? 'text-[#B87A12]' : 'text-text-tertiary'}>
                  <Icon />
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="shrink-0 border-t border-border px-5 py-4">
          <p className="text-[12px] font-medium text-text-tertiary">SLYDSHOW</p>
          <div className="mt-0.5 text-[11px] text-text-secondary">{footer}</div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-background px-8">
          <div className="min-w-0 flex-1 truncate text-[14px] text-text-secondary">{headerLeft}</div>
          <div className="ml-4 flex shrink-0 items-center gap-3">{headerRight}</div>
        </header>
        <main className="panel-scroll min-h-0 flex-1 overflow-y-auto px-8 py-7">{children}</main>
      </div>
    </div>
  );
}
