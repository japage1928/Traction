import type { ReactNode } from 'react';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-secondary">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Section({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

type Tone = 'info' | 'good' | 'warning' | 'critical';

const TONE_COLOR: Record<Tone, string> = {
  info: 'var(--series-1)',
  good: 'var(--status-good)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-critical)',
};

/**
 * Status is carried by an icon and the message text as well as the accent
 * colour, so it survives a colourblind reader or a forced-colors mode.
 */
const TONE_ICON: Record<Tone, string> = {
  info: 'ⓘ',
  good: '✓',
  warning: '⚠',
  critical: '✕',
};

export function Banner({
  tone = 'info',
  children,
  className = '',
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={`flex items-start gap-2.5 rounded-lg border border-line bg-surface px-4 py-3 text-sm text-ink-secondary ${className}`}
      style={{ borderLeftWidth: 3, borderLeftColor: TONE_COLOR[tone] }}
    >
      <span aria-hidden style={{ color: TONE_COLOR[tone] }}>
        {TONE_ICON[tone]}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <div className="py-10 text-center text-sm text-ink-muted">{label}</div>;
}
