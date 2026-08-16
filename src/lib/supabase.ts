import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * True when the app has been pointed at a Supabase project. When false the UI
 * shows setup instructions rather than a wall of failed requests.
 */
export const isSupabaseConfigured = Boolean(url && anonKey && !url.includes('your-project'));

if (!isSupabaseConfigured) {
  console.warn(
    'Supabase is not configured. Copy .env.example to .env and set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  );
}

// Fall back to harmless placeholders so module import never throws; every call
// will fail loudly at request time instead, which the UI handles.
export const supabase = createClient(url || 'http://localhost:54321', anonKey || 'public-anon-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
