import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Two clients, two trust levels.
 *
 *  - `serviceClient()` bypasses row-level security. Use it only after you have
 *    independently established which user the request belongs to, and always
 *    scope queries by that user id yourself.
 *  - `userClientFromRequest()` carries the caller's JWT, so RLS applies exactly
 *    as it does in the browser. Prefer this whenever it is sufficient.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/**
 * The anon key is the same value the browser bundle uses. Netlify exposes
 * VITE_-prefixed build variables to functions too, so accept either name and
 * let a dedicated SUPABASE_ANON_KEY win when both are present.
 */
function anonKey(): string {
  const value = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!value) throw new Error('Missing SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY).');
  return value;
}

export function serviceClient(): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface AuthedContext {
  userId: string;
  accessToken: string;
  /** RLS-scoped client acting as the caller. */
  db: SupabaseClient;
}

/**
 * Resolves the caller from the Authorization header. Returns null when the
 * header is missing or the token does not verify — callers should map that to
 * a 401 rather than treating it as an error.
 */
export async function authenticate(req: Request): Promise<AuthedContext | null> {
  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;

  const accessToken = match[1];
  const db = createClient(requireEnv('SUPABASE_URL'), anonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const { data, error } = await db.auth.getUser(accessToken);
  if (error || !data.user) return null;

  return { userId: data.user.id, accessToken, db };
}
