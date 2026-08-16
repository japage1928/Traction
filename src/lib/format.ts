/** Formatting helpers shared across the dashboard. */

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('en');

/** 12_400 → "12.4K". Used for stat tiles and axis ticks. */
export function formatCompact(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return compact.format(value);
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return full.format(value);
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

/** Signed percentage change between two readings. Null when there is no base. */
export function percentChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

export function formatDelta(value: number | null): string {
  if (value == null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

/** "2026-08-16" → "Aug 16" for compact axis labels. */
export function formatShortDate(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return date.toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function formatRelative(iso: string | null): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

/**
 * The categorical palette, in slot order. Assign by index and never cycle —
 * a ninth series folds into "Other" rather than reusing slot 1.
 */
export const SERIES_COLORS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
  'var(--series-8)',
] as const;

export function seriesColor(index: number): string {
  return SERIES_COLORS[index] ?? 'var(--text-muted)';
}
