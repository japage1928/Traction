import type { TooltipProps } from 'recharts';
import { formatNumber, formatShortDate } from '@/lib/format';

/**
 * Shared tooltip. Values and labels wear text tokens; the small colour chip
 * beside each row is what carries series identity, so the text stays readable
 * at any contrast.
 */
export function ChartTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;

  const heading = typeof label === 'string' && /^\d{4}-\d{2}-\d{2}/.test(label) ? formatShortDate(label) : String(label ?? '');

  return (
    <div className="rounded-lg border border-line bg-surface-raised px-3 py-2 shadow-lg">
      {heading && <div className="mb-1.5 text-xs font-medium text-ink-secondary">{heading}</div>}
      <div className="space-y-1">
        {payload.map((entry) => (
          <div key={String(entry.dataKey)} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-ink-secondary">{entry.name}</span>
            <span className="tabular ml-auto font-medium text-ink">{formatNumber(entry.value ?? null)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Axis tick styling shared by every chart, kept deliberately recessive. */
export const axisProps = {
  stroke: 'var(--baseline)',
  tick: { fill: 'var(--text-muted)', fontSize: 11 },
  tickLine: false,
} as const;
