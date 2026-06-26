import type { ReactNode } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Avatar } from './Avatar';

export type AppView = 'board' | 'clients';

// Shared app header: brand + section nav (Board / Clients) + a contextual
// `right` slot for view-specific actions + the user chip and sign out.
export function TopBar({
  current,
  onNav,
  right,
}: {
  current: AppView;
  onNav: (v: AppView) => void;
  right?: ReactNode;
}) {
  const { profile, signOut } = useAuth();
  const displayName = profile?.full_name || profile?.email || 'You';

  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo sm">A</span>
        <span className="brand-name">
          Atlas <span className="dim">Core</span>
        </span>
        <span className="brand-sub">Cubitt Wren</span>
        <nav className="seg topnav" aria-label="Sections">
          <button
            className={'seg-btn' + (current === 'board' ? ' active' : '')}
            data-testid="nav-board"
            onClick={() => onNav('board')}
          >
            Board
          </button>
          <button
            className={'seg-btn' + (current === 'clients' ? ' active' : '')}
            data-testid="nav-clients"
            onClick={() => onNav('clients')}
          >
            Clients
          </button>
        </nav>
      </div>

      <div className="topbar-right">
        {right}
        <div className="user-chip">
          <Avatar name={displayName} id={profile?.id} size={28} />
          <div className="user-meta">
            <span className="user-name">{displayName}</span>
            <span className="user-role" data-testid="user-role">
              {profile?.role}
            </span>
          </div>
        </div>
        <button className="btn ghost" onClick={signOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}
