import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import {
  connectAccount,
  disconnectAccount,
  getProviderStatus,
  syncAccounts,
  type ProviderStatus,
} from '@/lib/api';
import { PageHeader, Section, Banner, Spinner } from '@/components/ui';
import { ConnectionCard } from '@/components/ConnectionCard';
import { PLATFORM_LABELS, type Platform, type SocialAccount } from '@shared/types';

/**
 * Account and connected-accounts management.
 *
 * The three platforms Traction targets first are surfaced at the top; anything
 * else already wired up appears under "Other platforms" so existing
 * connections stay reachable.
 */
const PRIMARY_PLATFORMS: Platform[] = ['x', 'tiktok', 'pinterest'];

export function Account() {
  const { user, profile } = useAuth();
  const [params, setParams] = useSearchParams();

  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [encryptionReady, setEncryptionReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showOthers, setShowOthers] = useState(false);

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
      setError(err instanceof Error ? err.message : 'Could not load your connected accounts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const connectResult = params.get('connect');
  const connectReason = params.get('reason');
  const connectPlatform = params.get('platform') as Platform | null;
  const connectHandle = params.get('handle');
  const partialScopes = params.get('partial');

  function dismissResult() {
    ['connect', 'reason', 'platform', 'partial', 'handle'].forEach((k) => params.delete(k));
    setParams(params, { replace: true });
  }

  async function handleConnect(platform: Platform) {
    setBusy(platform);
    setError(null);
    try {
      await connectAccount(platform, '/account');
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
          `Traction will ask ${label} to revoke access and will delete its stored credentials. ` +
          `Analytics already collected are kept.`,
      )
    ) {
      return;
    }

    setBusy(account.id);
    setError(null);
    setNotice(null);
    try {
      const result = await disconnectAccount(account.id);
      setNotice(result.note ?? (result.revoked ? `Disconnected. ${label} revoked Traction's access.` : 'Disconnected.'));
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

  const live = accounts.filter((a) => a.status !== 'disconnected');
  const retired = accounts.filter((a) => a.status === 'disconnected');
  const connectedPlatforms = new Set(live.map((a) => a.platform));

  const primary = providers.filter((p) => PRIMARY_PLATFORMS.includes(p.platform));
  const others = providers.filter((p) => !PRIMARY_PLATFORMS.includes(p.platform));
  const availableOthers = others.filter((p) => !connectedPlatforms.has(p.platform));

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 md:px-8 md:py-8">
      <PageHeader
        title="Account"
        subtitle={user?.email ?? undefined}
        actions={
          live.length > 0 && (
            <button type="button" className="btn-ghost text-xs" onClick={() => void handleSync()} disabled={busy !== null}>
              {busy === 'sync' ? 'Syncing…' : 'Sync all'}
            </button>
          )
        }
      />

      <Banner tone="info" className="mt-4">
        Connections use each platform’s own OAuth sign-in. You authorize Traction on their site — we never see your
        password and never ask for an API key. Access is read-only.
      </Banner>

      {connectResult === 'success' && (
        <Banner tone={partialScopes ? 'warning' : 'good'} className="mt-3">
          {partialScopes ? (
            <>
              Connected {connectHandle ? `@${connectHandle}` : ''}, but some permissions were declined (
              {partialScopes.split(',').join(', ')}), so parts of the dashboard will stay empty. Reconnect and accept
              them to fill it in.
            </>
          ) : (
            <>
              Connected {connectPlatform ? PLATFORM_LABELS[connectPlatform] : ''}
              {connectHandle ? ` — @${connectHandle}` : ''}.
            </>
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
          This deployment has no <code>TOKEN_ENCRYPTION_KEY</code>, so credentials can’t be stored securely.
          Connecting is disabled until it’s configured.
        </Banner>
      )}

      {loading ? (
        <Spinner />
      ) : (
        <div className="mt-6 space-y-4">
          <Section
            title="Connected accounts"
            subtitle={live.length ? `${live.length} connected` : 'None connected yet'}
          >
            <div className="space-y-2">
              {PRIMARY_PLATFORMS.map((platform) => {
                const provider = primary.find((p) => p.platform === platform);
                const platformAccounts = live.filter((a) => a.platform === platform);

                if (platformAccounts.length) {
                  return platformAccounts.map((account) => (
                    <ConnectionCard
                      key={account.id}
                      account={account}
                      provider={provider}
                      busy={busy === account.id}
                      disabled={busy !== null}
                      onDisconnect={() => void handleDisconnect(account)}
                      onReconnect={() => void handleConnect(account.platform)}
                    />
                  ));
                }

                return (
                  <ConnectPrompt
                    key={platform}
                    platform={platform}
                    provider={provider}
                    busy={busy === platform}
                    disabled={busy !== null || !encryptionReady}
                    onConnect={() => void handleConnect(platform)}
                  />
                );
              })}
            </div>
          </Section>

          {/* Platforms beyond the first three, plus any already connected. */}
          {(others.length > 0 || live.some((a) => !PRIMARY_PLATFORMS.includes(a.platform))) && (
            <Section
              title="Other platforms"
              subtitle="Also supported by Traction"
              action={
                <button
                  type="button"
                  className="text-xs text-ink-secondary hover:text-ink"
                  onClick={() => setShowOthers((v) => !v)}
                >
                  {showOthers ? 'Hide' : 'Show'}
                </button>
              }
            >
              {showOthers ? (
                <div className="space-y-2">
                  {live
                    .filter((a) => !PRIMARY_PLATFORMS.includes(a.platform))
                    .map((account) => (
                      <ConnectionCard
                        key={account.id}
                        account={account}
                        provider={others.find((p) => p.platform === account.platform)}
                        busy={busy === account.id}
                        disabled={busy !== null}
                        onDisconnect={() => void handleDisconnect(account)}
                        onReconnect={() => void handleConnect(account.platform)}
                      />
                    ))}
                  {availableOthers.map((provider) => (
                    <ConnectPrompt
                      key={provider.platform}
                      platform={provider.platform}
                      provider={provider}
                      busy={busy === provider.platform}
                      disabled={busy !== null || !encryptionReady}
                      onConnect={() => void handleConnect(provider.platform)}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-ink-muted">
                  {others.map((p) => p.label).join(', ')}
                </p>
              )}
            </Section>
          )}

          {retired.length > 0 && (
            <Section title="Previously connected" subtitle="Credentials removed; analytics history kept">
              <ul className="space-y-1.5">
                {retired.map((account) => (
                  <li key={account.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-ink-secondary">
                      {PLATFORM_LABELS[account.platform]} · @{account.handle}
                    </span>
                    <button
                      type="button"
                      className="btn-ghost shrink-0 text-xs"
                      disabled={busy !== null || !encryptionReady}
                      onClick={() => void handleConnect(account.platform)}
                    >
                      Reconnect
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Profile" subtitle="Used by the advisor and trend scans">
            <dl className="space-y-2 text-sm">
              <Row label="Email" value={user?.email ?? '—'} />
              <Row label="Name" value={profile?.display_name ?? '—'} />
              <Row label="Focus" value={profile?.niche ?? 'Not set'} />
            </dl>
            <p className="mt-3 text-xs text-ink-muted">
              Edit these in <a href="/settings" className="underline">Settings</a>.
            </p>
          </Section>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-ink-muted">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-ink">{value}</dd>
    </div>
  );
}

function ConnectPrompt({
  platform,
  provider,
  busy,
  disabled,
  onConnect,
}: {
  platform: Platform;
  provider?: ProviderStatus;
  busy: boolean;
  disabled: boolean;
  onConnect: () => void;
}) {
  const configured = provider?.configured ?? false;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-line p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink">{PLATFORM_LABELS[platform]}</span>
          {provider?.usesPkce && (
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-muted"
              style={{ backgroundColor: 'var(--surface-sunken)' }}
              title="Authorization code is bound to a one-time verifier that never leaves the server."
            >
              PKCE
            </span>
          )}
        </div>
        {configured ? (
          <>
            <p className="mt-1 text-xs text-ink-secondary">{provider?.permissionSummary}</p>
            <p className="mt-1 text-xs text-ink-muted">Scopes: {provider?.scopes.join(', ')}</p>
          </>
        ) : (
          <p className="mt-1 text-xs text-ink-muted">
            Not configured on this deployment. Set {provider?.missingEnv.join(' and ') ?? 'its OAuth credentials'}.
          </p>
        )}
      </div>

      <button
        type="button"
        className="btn-ghost shrink-0 text-xs"
        disabled={disabled || !configured}
        onClick={onConnect}
      >
        {busy ? 'Redirecting…' : `Connect ${PLATFORM_LABELS[platform]}`}
      </button>
    </div>
  );
}
