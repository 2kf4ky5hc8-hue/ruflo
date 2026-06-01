import type { ReactNode } from 'react';
import Link from 'next/link';
import { signOut } from '@/lib/auth';

async function signOutAction() {
  'use server';
  await signOut({ redirectTo: '/login' });
}

const NAV: Array<{ href: string; label: string }> = [
  { href: '/dashboard',  label: 'Dashboard'  },
  { href: '/risk',       label: 'Risk'       },
  { href: '/accounts',   label: 'Accounts'   },
  { href: '/holdings',   label: 'Holdings'   },
  { href: '/plan',       label: 'Plan'       },
  { href: '/paper',      label: 'Paper'      },
  { href: '/business',   label: 'Business'   },
  { href: '/debt',       label: 'Debt'       },
  { href: '/protection', label: 'Protection' },
  { href: '/approvals',  label: 'Approvals'  },
];

export function AppShell({ children, current }: { children: ReactNode; current: string }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
          <div className="font-semibold tracking-tight">Ruflo Wealth</div>
          <nav className="flex gap-1 text-sm">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href}
                    className={`rounded-md px-3 py-1.5 ${
                      current === n.href ? 'bg-ink text-white' : 'hover:bg-line/40'
                    }`}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto">
            <form action={signOutAction}>
              <button className="btn btn-ghost text-sm" type="submit">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
