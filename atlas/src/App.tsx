import { useState } from 'react';
import { useAuth } from './auth/AuthProvider';
import { LoginPage } from './auth/LoginPage';
import { UpdatePassword } from './auth/UpdatePassword';
import { Board } from './board/Board';
import { ClientsView } from './clients/ClientsView';
import type { AppView } from './components/TopBar';

export default function App() {
  const { session, loading, recovery, clearRecovery } = useAuth();
  const [view, setView] = useState<AppView>('board');

  if (loading) return <div className="center muted">Loading…</div>;
  if (recovery) return <UpdatePassword onDone={clearRecovery} />;
  if (!session) return <LoginPage />;

  return view === 'board' ? (
    <Board onNav={setView} />
  ) : (
    <ClientsView onNav={setView} />
  );
}
