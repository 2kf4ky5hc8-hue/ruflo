import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setBusy(false);
  }

  async function resetPassword() {
    if (!email) {
      setError('Enter your email above first, then click reset.');
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) setError(error.message);
    else setInfo('Password reset email sent. Check your inbox.');
    setBusy(false);
  }

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={signIn}>
        <div className="auth-brand">
          <span className="logo">A</span>
          <div>
            <div className="brand-name">
              Atlas <span className="dim">Core</span>
            </div>
            <div className="muted small">Cubitt Wren · Operations</div>
          </div>
        </div>

        <h1 className="auth-title">Sign in</h1>
        <p className="auth-sub">Welcome back. Sign in to view the board.</p>

        <label>
          Email
          <input
            type="email"
            data-testid="login-email"
            value={email}
            autoComplete="username"
            placeholder="you@cubittwren.co.uk"
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            data-testid="login-password"
            value={password}
            autoComplete="current-password"
            placeholder="••••••••"
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {error && <div className="alert error">{error}</div>}
        {info && <div className="alert info">{info}</div>}

        <button
          className="btn primary block"
          data-testid="login-submit"
          type="submit"
          disabled={busy}
        >
          {busy ? 'Please wait…' : 'Sign in'}
        </button>
        <button
          type="button"
          className="btn link"
          onClick={resetPassword}
          disabled={busy}
        >
          Forgot password?
        </button>

        <div className="auth-foot">Invite-only · contact an admin for access</div>
      </form>
    </div>
  );
}
