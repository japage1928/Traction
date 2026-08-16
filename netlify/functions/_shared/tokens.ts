import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptToken, encryptToken } from './crypto.js';
import { refreshAccessToken, type ProviderDefinition, type TokenSet } from './providers.js';

/**
 * Reading and writing stored OAuth tokens.
 *
 * Tokens live in `social_account_tokens`, which has row-level security enabled
 * and deliberately no policies — PostgREST denies every browser request, so
 * only a service-role client can reach this table. On top of that they are
 * encrypted with AES-256-GCM, so a database dump alone yields nothing usable.
 */

interface TokenRow {
  access_token_enc: string;
  refresh_token_enc: string | null;
  expires_at: string | null;
}

/** Refresh this far ahead of nominal expiry to absorb clock skew. */
const REFRESH_MARGIN_MS = 60_000;

export async function loadTokens(
  db: SupabaseClient,
  accountId: string,
  grantedScopes: string[],
): Promise<TokenSet | null> {
  const { data, error } = await db
    .from('social_account_tokens')
    .select('access_token_enc, refresh_token_enc, expires_at')
    .eq('account_id', accountId)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as TokenRow;
  return {
    accessToken: decryptToken(row.access_token_enc),
    refreshToken: row.refresh_token_enc ? decryptToken(row.refresh_token_enc) : undefined,
    expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
    scopes: grantedScopes,
  };
}

export async function saveTokens(
  db: SupabaseClient,
  accountId: string,
  tokens: TokenSet,
): Promise<void> {
  const { error } = await db.from('social_account_tokens').upsert({
    account_id: accountId,
    access_token_enc: encryptToken(tokens.accessToken),
    refresh_token_enc: tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
    expires_at: tokens.expiresAt?.toISOString() ?? null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

/**
 * Returns a token set that is valid now, refreshing and persisting it first if
 * it is at or near expiry. Callers should always go through this rather than
 * using `loadTokens` output directly.
 */
export async function ensureFreshTokens(
  db: SupabaseClient,
  provider: ProviderDefinition,
  accountId: string,
  tokens: TokenSet,
): Promise<TokenSet> {
  const expiresAt = tokens.expiresAt?.getTime();
  if (!expiresAt || expiresAt - Date.now() > REFRESH_MARGIN_MS) return tokens;

  const refreshed = await refreshAccessToken(provider, tokens);
  // Providers that omit `scope` on refresh keep the originally granted set.
  const next: TokenSet = { ...refreshed, scopes: refreshed.scopes.length ? refreshed.scopes : tokens.scopes };
  await saveTokens(db, accountId, next);
  return next;
}
