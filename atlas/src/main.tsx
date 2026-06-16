import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider } from './auth/AuthProvider';
import { supabaseConfigured } from './lib/supabase';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);

if (!supabaseConfigured) {
  // Missing env vars (e.g. forgotten on the host). Show a clear message
  // instead of a blank screen.
  root.render(
    <div className="auth">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="logo">A</span>
          <div>
            <div className="brand-name">
              Atlas <span className="dim">Core</span>
            </div>
            <div className="muted small">Cubitt Wren · Operations</div>
          </div>
        </div>
        <h1 className="auth-title">Configuration needed</h1>
        <p className="auth-sub">
          This deployment is missing its Supabase settings. Set the{' '}
          <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>{' '}
          environment variables on the host, then redeploy.
        </p>
      </div>
    </div>,
  );
} else {
  root.render(
    <React.StrictMode>
      <AuthProvider>
        <App />
      </AuthProvider>
    </React.StrictMode>,
  );
}
