import { authenticate, serviceClient } from './_shared/supabase.js';
import { error, json, withErrorHandling } from './_shared/http.js';
import { canReadProfile, collectMetrics, getProvider } from './_shared/providers.js';
import { ensureFreshTokens, loadTokens } from './_shared/tokens.js';
import type { Platform } from '../../shared/types.js';

/**
 * POST /.netlify/functions/sync
 *
 * Pulls a fresh metrics snapshot for every active account the caller owns.
 *
 * Only the metric sources whose scopes the user actually granted are called —
 * a partial consent produces partial data rather than an unauthorized request.
 * Individual account failures are recorded on the account and reported back
 * but never abort the run: one revoked token should not stop the rest of the
 * dashboard from updating.
 */

interface AccountRow {
  id: string;
  platform: Platform;
  handle: string;
  scopes: string[] | null;
}

interface SyncResult {
  accountId: string;
  platform: Platform;
  handle: string;
  ok: boolean;
  message?: string;
  /** Capabilities the user did not authorize, so the UI can explain the gap. */
  skipped?: Array<{ label: string; missingScopes: string[] }>;
}

export default withErrorHandling(async (req: Request) => {
  if (req.method !== 'POST') return error('Method not allowed', 405);

  const auth = await authenticate(req);
  if (!auth) return error('Not signed in', 401);

  const db = serviceClient();

  const { data: accounts, error: accountsError } = await db
    .from('social_accounts')
    .select('id, platform, handle, scopes')
    .eq('user_id', auth.userId)
    .eq('is_active', true);

  if (accountsError) throw new Error(accountsError.message);
  if (!accounts?.length) {
    return json({ results: [], synced: 0, failed: 0, message: 'No connected accounts to sync.' });
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
      const grantedScopes = account.scopes ?? [];

      const stored = await loadTokens(db, account.id, grantedScopes);
      if (!stored) throw new Error('No stored credentials. Reconnect this account.');

      const tokens = await ensureFreshTokens(db, provider, account.id, stored);

      if (!canReadProfile(provider, grantedScopes)) {
        throw new Error(
          `This connection is missing the ${provider.profileScopes.join(', ')} scope. Reconnect and accept the requested permissions.`,
        );
      }

      const profile = await provider.fetchProfile(tokens.accessToken);
      const { metrics, skipped, failed } = await collectMetrics(
        provider,
        tokens.accessToken,
        profile,
        grantedScopes,
      );

      // A source that was authorized but errored is a real problem; a source
      // that was never authorized is expected and only worth reporting.
      if (failed.length && failed.length === provider.metricSources.length - skipped.length) {
        throw new Error(failed.map((f) => `${f.label}: ${f.message}`).join('; '));
      }

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
          last_sync_error: failed.length ? failed.map((f) => `${f.label}: ${f.message}`).join('; ').slice(0, 500) : null,
          handle: profile.handle,
          display_name: profile.displayName ?? null,
          avatar_url: profile.avatarUrl ?? null,
        })
        .eq('id', account.id);

      results.push({
        accountId: account.id,
        platform: account.platform,
        handle: account.handle,
        ok: true,
        skipped: skipped.map((s) => ({ label: s.label, missingScopes: s.missingScopes })),
      });
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
