import { authenticate, serviceClient } from './_shared/supabase.js';
import { error, json, withErrorHandling } from './_shared/http.js';
import { getProvider, refreshAccessToken } from './_shared/providers.js';
import { decryptToken, encryptToken } from './_shared/crypto.js';
import type { Platform } from '../../shared/types.js';

/**
 * POST /.netlify/functions/sync
 *
 * Pulls a fresh metrics snapshot for every active account the caller owns and
 * writes one row per account per day. Individual account failures are recorded
 * on the account and reported back, but do not abort the run — one revoked
 * token should not block the rest of the dashboard from updating.
 */

interface AccountRow {
  id: string;
  platform: Platform;
  handle: string;
}

interface TokenRow {
  access_token_enc: string;
  refresh_token_enc: string | null;
  expires_at: string | null;
}

interface SyncResult {
  accountId: string;
  platform: Platform;
  handle: string;
  ok: boolean;
  message?: string;
}

export default withErrorHandling(async (req: Request) => {
  if (req.method !== 'POST') return error('Method not allowed', 405);

  const auth = await authenticate(req);
  if (!auth) return error('Not signed in', 401);

  const db = serviceClient();

  const { data: accounts, error: accountsError } = await db
    .from('social_accounts')
    .select('id, platform, handle')
    .eq('user_id', auth.userId)
    .eq('is_active', true);

  if (accountsError) throw new Error(accountsError.message);
  if (!accounts?.length) {
    return json({ results: [], message: 'No connected accounts to sync.' });
  }

  const { data: run } = await db
    .from('sync_runs')
    .insert({ user_id: auth.userId, status: 'running' })
    .select('id')
    .single();

  const today = new Date().toISOString().slice(0, 10);
  const results: SyncResult[] = [];

  for (const account of accounts as AccountRow[]) {
    try {
      const provider = getProvider(account.platform);

      const { data: tokenRow, error: tokenError } = await db
        .from('social_account_tokens')
        .select('access_token_enc, refresh_token_enc, expires_at')
        .eq('account_id', account.id)
        .single();

      if (tokenError || !tokenRow) {
        throw new Error('No stored credentials. Reconnect this account.');
      }

      const stored = tokenRow as TokenRow;
      let accessToken = decryptToken(stored.access_token_enc);

      // Refresh a minute before nominal expiry to absorb clock skew.
      const expiresAt = stored.expires_at ? new Date(stored.expires_at).getTime() : null;
      if (expiresAt && expiresAt - Date.now() < 60_000) {
        if (!stored.refresh_token_enc) {
          throw new Error('Access token expired and no refresh token is available. Reconnect.');
        }
        const refreshed = await refreshAccessToken(provider, decryptToken(stored.refresh_token_enc));
        accessToken = refreshed.accessToken;
        await db.from('social_account_tokens').update({
          access_token_enc: encryptToken(refreshed.accessToken),
          refresh_token_enc: refreshed.refreshToken ? encryptToken(refreshed.refreshToken) : stored.refresh_token_enc,
          expires_at: refreshed.expiresAt?.toISOString() ?? null,
          updated_at: new Date().toISOString(),
        }).eq('account_id', account.id);
      }

      const profile = await provider.fetchProfile(accessToken);
      const metrics = await provider.fetchMetrics(accessToken, profile);

      const { error: metricsError } = await db.from('account_metrics').upsert(
        {
          user_id: auth.userId,
          account_id: account.id,
          platform: account.platform,
          captured_on: today,
          followers: metrics.followers,
          following: metrics.following,
          posts_count: metrics.postsCount,
          impressions: metrics.impressions,
          engagements: metrics.engagements,
          profile_views: metrics.profileViews,
          link_clicks: metrics.linkClicks,
        },
        { onConflict: 'account_id,captured_on' },
      );

      if (metricsError) throw new Error(metricsError.message);

      await db
        .from('social_accounts')
        .update({
          last_synced_at: new Date().toISOString(),
          last_sync_status: 'success',
          last_sync_error: null,
          handle: profile.handle,
          display_name: profile.displayName ?? null,
          avatar_url: profile.avatarUrl ?? null,
        })
        .eq('id', account.id);

      results.push({ accountId: account.id, platform: account.platform, handle: account.handle, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[sync] ${account.platform}/${account.handle}:`, message);

      await db
        .from('social_accounts')
        .update({ last_sync_status: 'error', last_sync_error: message.slice(0, 500) })
        .eq('id', account.id);

      results.push({
        accountId: account.id,
        platform: account.platform,
        handle: account.handle,
        ok: false,
        message,
      });
    }
  }

  const failures = results.filter((r) => !r.ok);

  if (run) {
    await db
      .from('sync_runs')
      .update({
        status: failures.length === results.length ? 'error' : 'success',
        message: failures.length ? `${failures.length} of ${results.length} accounts failed.` : null,
        finished_at: new Date().toISOString(),
      })
      .eq('id', run.id);
  }

  return json({ results, synced: results.length - failures.length, failed: failures.length });
});
