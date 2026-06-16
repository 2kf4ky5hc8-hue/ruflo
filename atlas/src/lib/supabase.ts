import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// True only when both public client values are present. When false, the app
// shows a configuration message instead of crashing with a blank screen.
export const supabaseConfigured = Boolean(url && anonKey);

// Only the public anon key lives here — safe to ship to the browser.
// Session tokens are the only thing kept in browser storage (Supabase default).
export const supabase: SupabaseClient = supabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : (null as unknown as SupabaseClient);
