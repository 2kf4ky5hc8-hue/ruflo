import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

export function UpdatePassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError('Use at least 8 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setError(error.message);
    else onDone();
  }

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <span className="logo">A</span>
          <div>
            <div className="brand-name">
              Atlas <span className="dim">Core</span>
            </div>
            <div className="muted small">Cubitt Wren · Operations</div>
          </div>
        </div>

        <h1 className="auth-title">Set a new password</h1>
        <p className="auth-sub">Choose a password to finish signing in.</p>

        <label>
          New password
          <input
            type="password"
            value={password}
            autoComplete="new-password"
            placeholder="At least 8 characters"
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <div className="alert error">{error}</div>}
        <button className="btn primary block" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </div>
  );
}
