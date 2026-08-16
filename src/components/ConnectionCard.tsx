import type { ProviderStatus } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import {
  CONNECTION_STATUS_LABELS,
  PLATFORM_LABELS,
  type ConnectionStatus,
  type SocialAccount,
} from '@shared/types';

/**
 * Colour is a supporting cue only — every state also carries a glyph and its
 * name in words, so the status survives a colourblind reader, a screenshot in
 * greyscale, or forced-colors mode.
 */
const STATUS_STYLE: Record<ConnectionStatus, { color: string; icon: string }> = {
  connected: { color: 'var(--status-good)', icon: '✓' },
  needs_reauthorization: { color: 'var(--status-warning)', icon: '⚠' },
  error: { color: 'var(--status-serious)', icon: '!' },
  disconnected: { color: 'var(--text-muted)', icon: '—' },
};

export function ConnectionCard({
  account,
  provider,
  busy,
  disabled,
  onDisconnect,
  onReconnect,
}: {
  account: SocialAccount;
  provider?: ProviderStatus;
  busy: boolean;
  disabled: boolean;
  onDisconnect: () => void;
  onReconnect: () => void;
}) {
  const status = account.status ?? 'connected';
  const style = STATUS_STYLE[status];
  const needsAction = status === 'needs_reauthorization';

  return (
    <div className="rounded-lg border border-line p-3" style={needsAction ? { borderLeftWidth: 3, borderLeftColor: style.color } : undefined}>
      <div className="flex items-center gap-3">
        {account.avatar_url ? (
          <img src={account.avatar_url} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-xs font-medium text-ink-secondary">
            {PLATFORM_LABELS[account.platform].slice(0, 2)}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-ink">{PLATFORM_LABELS[account.platform]}</div>
          <div className="truncate text-xs text-ink-secondary">
            {account.display_name && account.display_name !== account.handle
              ? `${account.display_name} · @${account.handle}`
              : `@${account.handle}`}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span className="inline-flex items-center gap-1" style={{ color: style.color }}>
              <span aria-hidden>{style.icon}</span>
              {CONNECTION_STATUS_LABELS[status]}
            </span>
            <span className="text-ink-muted">
              · connected {formatRelative(account.last_authorized_at ?? account.connected_at)}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-1.5">
          {needsAction && (
            <button type="button" className="btn-ghost text-xs" disabled={disabled} onClick={onReconnect}>
              Reconnect
            </button>
          )}
          <button type="button" className="btn-ghost text-xs" disabled={disabled} onClick={onDisconnect}>
            {busy ? 'Revoking…' : 'Disconnect'}
          </button>
        </div>
      </div>

      {account.status_detail && (
        <p className="mt-2.5 border-t border-line pt-2.5 text-xs text-ink-secondary">{account.status_detail}</p>
      )}

      {account.scopes?.length > 0 && (
        <p className="mt-2 text-xs text-ink-muted">
          <span className="font-medium text-ink-secondary">Authorized: </span>
          {account.scopes.join(', ')}
        </p>
      )}

      {provider && !provider.canRevoke && (
        <p className="mt-1.5 text-xs text-ink-muted">
          {PLATFORM_LABELS[account.platform]} publishes no revocation endpoint — disconnecting deletes Traction’s
          stored credentials, but also remove Traction in your {PLATFORM_LABELS[account.platform]} settings to fully
          withdraw access.
        </p>
      )}
    </div>
  );
}
