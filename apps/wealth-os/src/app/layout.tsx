import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Ruflo Wealth',
  description: 'Personal wealth command centre — decision-support, not regulated advice.',
};

// Every route reads from the user's DB at request time. Static prerendering
// would just fail at build with ECONNREFUSED — opt the whole app into dynamic
// rendering so `next build` doesn't try.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-dvh antialiased">
        {children}
        <footer className="mx-auto max-w-7xl px-6 py-10 text-xs text-muted">
          Decision-support, not regulated financial advice. Consult an FCA-authorised
          adviser for personalised advice.
        </footer>
      </body>
    </html>
  );
}
