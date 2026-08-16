import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartTooltip, axisProps } from './ChartTooltip';
import { EmptyPlot } from './FollowerTrendChart';
import { formatCompact, formatShortDate, seriesColor } from '@/lib/format';

interface EngagementChartProps {
  data: Array<{ date: string; impressions: number; engagements: number }>;
}

/**
 * Daily reach and interaction.
 *
 * Impressions and engagements differ by an order of magnitude, which is
 * exactly the situation a dual axis would paper over. They share one scale
 * here: the point is the gap between them, and a shared scale is what makes
 * that gap legible.
 */
export function EngagementChart({ data }: EngagementChartProps) {
  if (!data.length) {
    return <EmptyPlot message="No engagement data yet. Connect an account and run a sync." />;
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }} barGap={2}>
          <CartesianGrid strokeDasharray="0" vertical={false} />
          <XAxis dataKey="date" tickFormatter={formatShortDate} minTickGap={28} {...axisProps} />
          <YAxis tickFormatter={(v) => formatCompact(Number(v))} width={44} {...axisProps} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--gridline)', fillOpacity: 0.4 }} />
          {/* 4px rounded data-ends, square where the bar meets the baseline. */}
          <Bar dataKey="impressions" name="Impressions" fill={seriesColor(0)} radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Bar dataKey="engagements" name="Engagements" fill={seriesColor(1)} radius={[4, 4, 0, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {[
          { label: 'Impressions', index: 0 },
          { label: 'Engagements', index: 1 },
        ].map(({ label, index }) => (
          <div key={label} className="flex items-center gap-1.5 text-xs text-ink-secondary">
            <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: seriesColor(index) }} />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
