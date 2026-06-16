import { useAuth } from './auth/AuthProvider';
import { LoginPage } from './auth/LoginPage';
import { UpdatePassword } from './auth/UpdatePassword';
import { Board } from './board/Board';

export default function App() {
  const { session, loading, recovery, clearRecovery } = useAuth();

  if (loading) return <div className="center muted">Loading…</div>;
  if (recovery) return <UpdatePassword onDone={clearRecovery} />;
  if (!session) return <LoginPage />;
  return <Board />;
}
