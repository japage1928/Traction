import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { connectAccount, getProviderStatus, syncAccounts, type ProviderStatus } from '@/lib/api';
import { PageHeader, Section, Banner, Spinner } from '@/components/ui';
import { formatRelative } from '@/lib/format';
import { PLATFORM_LABELS, type SocialAccount } from '@shared/types';

export function Accounts() {
  const [params, setParams] = useSearchParams();
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [encryptionReady, setEncryptionReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [accountsRes, status] = await Promise.all([
        supabase.from('social_accounts').select('*').order('connected_at', { ascending: true }),
        getProviderStatus(),
      ]);
      if (accountsRes.error) throw new Error(accountsRes.error.message);
      setAccounts((accountsRes.data as SocialAccount[]) ?? []);
      setProviders(status.providers);
      setEncryptionReady(status.encryptionReady);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load accounts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The OAuth callback redirects back here with a result flag.
  const connectResult = params.get('connect');
  const connectReason = params.get('reason');

  function dismissResult() {
    params.delete('connect');
    params.delete('reason');
    params.delete('platform');
    setParams(params, { replace: true });
  }

  async function handleConnect(platform: ProviderStatus['platform']) {
    setBusy(platform);
    setError(null);
    try {
      await connectAccount(platform, '/accounts');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the connection.');
      setBusy(null);
    }
  }

  async function handleDisconnect(account: SocialAccount) {
    if (!confirm(`Disconnect ${PLATFORM_LABELS[account.platform]} @${account.handle}? Historical metrics are kept.`)) {
      return;
    }
    setBusy(account.id);
    try {
      // Deleting the account cascades to its stored tokens.
      const { error: deleteError } = await supabase.from('social_accounts').delete().eq('id', account.id);
      if (deleteError) throw new Error(deleteError.message);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect.');
    } finally {
      setBusy(null);
    }
  }

  async function handleSync() {
    setBusy('sync');
    setError(null);
    try {
      await syncAccounts();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed.');
    } finally {
      setBusy(null);
    }
  }

  const connected = new Set(accounts.map((a) => a.platform));
  const available = providers.filter((p) => !connected.has(p.platform));

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 md:px-8 md:py-8">
      <PageHeader
        title="Accounts"
        subtitle="Traction reads these to work out what’s landing."
        actions={
          accounts.length > 0 && (
            <button type="button" className="btn-ghost text-xs" onClick={() => void handleSync()} disabled={busy !== null}>
              {busy === 'sync' ? 'Syncing…' : 'Sync all'}
            </button>
          )
        }
      />

      {connectResult === 'success' && (
        <Banner tone="good" className="mt-4">
          Connected. <button onClick={dismissResult} className="underline">Dismiss</button>
        </Banner>
      )}
      {connectResult === 'error' && (
        <Banner tone="critical" className="mt-4">
          {connectReason ?? 'The connection did not complete.'}{' '}
          <button onClick={dismissResult} className="underline">Dismiss</button>
        </Banner>
      )}
      {error && (
        <Banner tone="critical" className="mt-4">
          {error}
        </Banner>
      )}
      {!encryptionReady && (
        <Banner tone="warning" className="mt-4">
          <code>TOKEN_ENCRYPTION_KEY</code> is not set, so account tokens can’t be stored securely. Connecting is
          disabled until it is configured.
        </Banner>
      )}

      {loading ? (
        <Spinner />
      ) : (
        <div className="mt-6 space-y-4">
          {accounts.length > 0 && (
            <Section title="Connected" subtitle={`${accounts.length} account${accounts.length === 1 ? '' : 's'}`}>
              <ul className="space-y-2">
                {accounts.map((account) => (
                  <li key={account.id} className="flex items-center gap-3 rounded-lg border border-line p-3">
                    {account.avatar_url ? (
                      <img src={account.avatar_url} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-xs font-medium text-ink-secondary">
                        {PLATFORM_LABELS[account.platform].slice(0, 2)}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink">
                        {account.display_name ?? account.handle}
                      </div>
                      <div className="truncate text-xs text-ink-muted">
                        {PLATFORM_LABELS[account.platform]} · @{account.handle}
                      </div>
                    </div>

                    <SyncBadge account={account} />

                    <button
                      type="button"
                      className="btn-ghost shrink-0 text-xs"
                      onClick={() => void handleDisconnect(account)}
                      disabled={busy !== null}
                    >
                      Disconnect
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section
            title={accounts.length ? 'Add another' : 'Connect your first account'}
            subtitle="Only read access is requested — Traction never posts on your behalf."
          >
            {available.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-muted">Everything available is already connected.</p>
            ) : (
              <ul className="space-y-2">
                {available.map((provider) => (
                  <li key={provider.platform} className="flex items-center gap-3 rounded-lg border border-line p-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-ink">{provider.label}</div>
                      {provider.configured ? (
                        <div className="truncate text-xs text-ink-muted">{provider.scopes.join(', ')}</div>
                      ) : (
                        <div className="text-xs text-ink-muted">
                          Not configured on this deployment. Set {provider.missingEnv.join(' and ')}.
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn-ghost shrink-0 text-xs"
                      disabled={!provider.configured || !encryptionReady || busy !== null}
                      onClick={() => void handleConnect(provider.platform)}
                    >
                      {busy === provider.platform ? 'Redirecting…' : 'Connect'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

/** Sync state carries a word as well as a colour. */
function SyncBadge({ account }: { account: SocialAccount }) {
  if (account.last_sync_status === 'error') {
    return (
      <span
        className="shrink-0 text-xs"
        style={{ color: 'var(--status-critical)' }}
        title={account.last_sync_error ?? undefined}
      >
        <span aria-hidden>✕</span> Sync failed
      </span>
    );
  }
  if (!account.last_synced_at) {
    return <span className="shrink-0 text-xs text-ink-muted">Never synced</span>;
  }
  return <span className="shrink-0 text-xs text-ink-muted">{formatRelative(account.last_synced_at)}</span>;
}
