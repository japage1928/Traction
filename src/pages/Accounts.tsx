import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import {
  connectAccount,
  disconnectAccount,
  getProviderStatus,
  syncAccounts,
  type ProviderStatus,
} from '@/lib/api';
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
  const [notice, setNotice] = useState<string | null>(null);

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
  const partialScopes = params.get('partial');

  function dismissResult() {
    ['connect', 'reason', 'platform', 'partial'].forEach((k) => params.delete(k));
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
    const label = PLATFORM_LABELS[account.platform];
    if (
      !confirm(
        `Disconnect ${label} @${account.handle}?\n\n` +
          `Traction will ask ${label} to revoke its access. Metrics already collected are kept.`,
      )
    ) {
      return;
    }

    setBusy(account.id);
    setError(null);
    setNotice(null);
    try {
      const result = await disconnectAccount(account.id);
      setNotice(
        result.note ??
          (result.revoked
            ? `Disconnected. ${label} has revoked Traction's access.`
            : 'Disconnected.'),
      );
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
  const providerFor = (platform: string) => providers.find((p) => p.platform === platform);

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

      <Banner tone="info" className="mt-4">
        Every connection uses the platform’s own OAuth sign-in. You authorize Traction on their site — we never see
        your password, and never ask for an API key.
      </Banner>

      {connectResult === 'success' && (
        <Banner tone={partialScopes ? 'warning' : 'good'} className="mt-3">
          {partialScopes ? (
            <>
              Connected, but some permissions were declined ({partialScopes.split(',').join(', ')}), so parts of the
              dashboard will stay empty. Reconnect and accept them to fill it in.
            </>
          ) : (
            'Connected.'
          )}{' '}
          <button onClick={dismissResult} className="underline">
            Dismiss
          </button>
        </Banner>
      )}
      {connectResult === 'error' && (
        <Banner tone="critical" className="mt-3">
          {connectReason ?? 'The connection did not complete.'}{' '}
          <button onClick={dismissResult} className="underline">
            Dismiss
          </button>
        </Banner>
      )}
      {notice && (
        <Banner tone="good" className="mt-3">
          {notice}
        </Banner>
      )}
      {error && (
        <Banner tone="critical" className="mt-3">
          {error}
        </Banner>
      )}
      {!encryptionReady && (
        <Banner tone="warning" className="mt-3">
          <code>TOKEN_ENCRYPTION_KEY</code> is not set, so access tokens can’t be stored securely. Connecting is
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
                  <li key={account.id} className="rounded-lg border border-line p-3">
                    <div className="flex items-center gap-3">
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
                        {busy === account.id ? 'Revoking…' : 'Disconnect'}
                      </button>
                    </div>

                    {account.scopes?.length > 0 && (
                      <div className="mt-2.5 border-t border-line pt-2.5">
                        <div className="text-xs text-ink-muted">
                          <span className="font-medium text-ink-secondary">You authorized: </span>
                          {account.scopes.join(', ')}
                        </div>
                        {!providerFor(account.platform)?.canRevoke && (
                          <div className="mt-1 text-xs text-ink-muted">
                            {PLATFORM_LABELS[account.platform]} has no revocation endpoint — disconnecting here removes
                            the token, but also remove Traction in your {PLATFORM_LABELS[account.platform]} settings to
                            fully withdraw access.
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section
            title={accounts.length ? 'Add another' : 'Connect your first account'}
            subtitle="Read-only access, requested through each platform’s official OAuth flow."
          >
            {available.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-muted">Everything available is already connected.</p>
            ) : (
              <ul className="space-y-2">
                {available.map((provider) => (
                  <li key={provider.platform} className="rounded-lg border border-line p-3">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-ink">{provider.label}</span>
                          {provider.usesPkce && (
                            <span
                              className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-muted"
                              style={{ backgroundColor: 'var(--surface-sunken)' }}
                              title="Authorization code is bound to a one-time verifier that never leaves the server."
                            >
                              PKCE
                            </span>
                          )}
                        </div>

                        {provider.configured ? (
                          <>
                            <p className="mt-1 text-xs text-ink-secondary">{provider.permissionSummary}</p>
                            <p className="mt-1 text-xs text-ink-muted">Scopes: {provider.scopes.join(', ')}</p>
                          </>
                        ) : (
                          <p className="mt-1 text-xs text-ink-muted">
                            Not configured on this deployment. Set {provider.missingEnv.join(' and ')}.
                          </p>
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
                    </div>
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
