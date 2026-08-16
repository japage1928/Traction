import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartTooltip, axisProps } from './ChartTooltip';
import { formatCompact, formatShortDate, seriesColor } from '@/lib/format';
import { PLATFORM_LABELS, type Platform } from '@shared/types';

interface FollowerTrendChartProps {
  /** One row per date; each connected platform contributes a numeric key. */
  data: Array<Record<string, string | number>>;
  platforms: Platform[];
}

/**
 * Follower count over time, one line per platform.
 *
 * Deliberately a single y-axis: platforms with wildly different follower counts
 * still share one scale, because two scales on one chart invite false
 * comparisons. If the spread ever makes small accounts unreadable, the fix is
 * small multiples, not a second axis.
 */
export function FollowerTrendChart({ data, platforms }: FollowerTrendChartProps) {
  if (!data.length || !platforms.length) {
    return <EmptyPlot message="No follower history yet. Run a sync to start the record." />;
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="0" vertical={false} />
          <XAxis dataKey="date" tickFormatter={formatShortDate} minTickGap={28} {...axisProps} />
          <YAxis tickFormatter={(v) => formatCompact(Number(v))} width={44} {...axisProps} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--baseline)', strokeWidth: 1 }} />
          {platforms.map((platform, index) => (
            <Line
              key={platform}
              type="monotone"
              dataKey={platform}
              name={PLATFORM_LABELS[platform]}
              stroke={seriesColor(index)}
              strokeWidth={2}
              dot={false}
              // Hover markers are comfortably larger than the 2px line so the
              // hit target is easy to land on.
              activeDot={{ r: 4.5, strokeWidth: 2, stroke: 'var(--surface-1)' }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <Legend platforms={platforms} />
    </div>
  );
}

/** Identity is never colour-alone: every series is named in the legend. */
export function Legend({ platforms }: { platforms: Platform[] }) {
  if (platforms.length < 2) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {platforms.map((platform, index) => (
        <div key={platform} className="flex items-center gap-1.5 text-xs text-ink-secondary">
          <span
            aria-hidden
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: seriesColor(index) }}
          />
          {PLATFORM_LABELS[platform]}
        </div>
      ))}
    </div>
  );
}

export function EmptyPlot({ message }: { message: string }) {
  return (
    <div className="flex h-[260px] items-center justify-center rounded-lg border border-dashed border-line px-6 text-center text-sm text-ink-muted">
      {message}
    </div>
  );
}
