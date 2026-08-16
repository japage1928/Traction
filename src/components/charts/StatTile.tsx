import { formatCompact, formatDelta } from '@/lib/format';

interface StatTileProps {
  label: string;
  value: number | null;
  /** Percent change vs the comparison window. Null hides the delta row. */
  delta?: number | null;
  /** For metrics where down is good (e.g. unsubscribes), flips the sense. */
  invertDelta?: boolean;
  hint?: string;
}

/**
 * A single headline number. Not a chart — when the answer is one figure, a
 * figure is the right form.
 *
 * The delta carries an arrow glyph and a written direction alongside the
 * colour, so it never depends on colour alone to be read.
 */
export function StatTile({ label, value, delta, invertDelta = false, hint }: StatTileProps) {
  const hasDelta = delta != null && Number.isFinite(delta);
  const isUp = hasDelta && delta > 0;
  const isFlat = hasDelta && Math.abs(delta) < 0.05;
  const isGood = invertDelta ? !isUp : isUp;

  const deltaColor = isFlat ? 'var(--text-muted)' : isGood ? 'var(--delta-up)' : 'var(--delta-down)';
  const arrow = isFlat ? '→' : isUp ? '↑' : '↓';
  const direction = isFlat ? 'no change' : isUp ? 'up' : 'down';

  return (
    <div className="card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-2 text-3xl font-semibold leading-none text-ink">{formatCompact(value)}</div>
      {hasDelta ? (
        <div className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: deltaColor }}>
          <span aria-hidden>{arrow}</span>
          <span className="tabular font-medium">{formatDelta(delta)}</span>
          <span className="sr-only">{direction}</span>
          <span className="text-ink-muted">vs previous period</span>
        </div>
      ) : (
        hint && <div className="mt-2 text-xs text-ink-muted">{hint}</div>
      )}
    </div>
  );
}
