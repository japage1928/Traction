import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { percentChange } from '@/lib/format';
import type { AccountMetric, Platform, SocialAccount, Task, TrendingTopic } from '@shared/types';

export interface DashboardData {
  accounts: SocialAccount[];
  platforms: Platform[];
  followerSeries: Array<Record<string, string | number>>;
  engagementSeries: Array<{ date: string; impressions: number; engagements: number }>;
  totals: {
    followers: number;
    impressions: number;
    engagements: number;
    engagementRate: number;
  };
  deltas: {
    followers: number | null;
    impressions: number | null;
    engagements: number | null;
    engagementRate: number | null;
  };
  tasks: Task[];
  trends: TrendingTopic[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const EMPTY_TOTALS = { followers: 0, impressions: 0, engagements: 0, engagementRate: 0 };
const EMPTY_DELTAS = { followers: null, impressions: null, engagements: null, engagementRate: null };

/**
 * Loads everything the dashboard renders, in one place.
 *
 * The comparison window is the period immediately before the visible one, of
 * equal length — so a 30-day view compares against the 30 days before it.
 */
export function useDashboardData(windowDays = 30): DashboardData {
  const [state, setState] = useState<Omit<DashboardData, 'reload'>>({
    accounts: [],
    platforms: [],
    followerSeries: [],
    engagementSeries: [],
    totals: EMPTY_TOTALS,
    deltas: EMPTY_DELTAS,
    tasks: [],
    trends: [],
    loading: true,
    error: null,
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      const windowStart = new Date(Date.now() - windowDays * 86_400_000);
      const comparisonStart = new Date(Date.now() - windowDays * 2 * 86_400_000);
      const windowStartIso = windowStart.toISOString().slice(0, 10);
      const comparisonStartIso = comparisonStart.toISOString().slice(0, 10);

      const [accountsRes, metricsRes, tasksRes, trendsRes] = await Promise.all([
        supabase.from('social_accounts').select('*').order('connected_at', { ascending: true }),
        supabase
          .from('account_metrics')
          .select('account_id, platform, captured_on, followers, impressions, engagements')
          .gte('captured_on', comparisonStartIso)
          .order('captured_on', { ascending: true }),
        supabase
          .from('tasks')
          .select('*')
          .in('status', ['suggested', 'accepted'])
          .order('priority', { ascending: true })
          .order('created_at', { ascending: false })
          .limit(12),
        supabase
          .from('trending_topics')
          .select('*')
          .order('captured_at', { ascending: false })
          .order('score', { ascending: false })
          .limit(8),
      ]);

      const firstError = accountsRes.error ?? metricsRes.error ?? tasksRes.error ?? trendsRes.error;
      if (firstError) throw new Error(firstError.message);

      const accounts = (accountsRes.data ?? []) as SocialAccount[];
      const allMetrics = (metricsRes.data ?? []) as Array<Pick<
        AccountMetric,
        'account_id' | 'platform' | 'captured_on' | 'followers' | 'impressions' | 'engagements'
      >>;

      const current = allMetrics.filter((m) => m.captured_on >= windowStartIso);
      const previous = allMetrics.filter((m) => m.captured_on < windowStartIso);

      const platforms = [...new Set(accounts.filter((a) => a.is_active).map((a) => a.platform))];

      // --- Follower series: one row per date, one numeric key per platform ---
      // Multiple accounts on the same platform are summed.
      const followerByDate = new Map<string, Record<string, number>>();
      for (const m of current) {
        const row = followerByDate.get(m.captured_on) ?? {};
        row[m.platform] = (row[m.platform] ?? 0) + m.followers;
        followerByDate.set(m.captured_on, row);
      }
      const followerSeries = [...followerByDate.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, values]) => ({ date, ...values }));

      // --- Engagement series: totals across all platforms per date ---
      const engagementByDate = new Map<string, { impressions: number; engagements: number }>();
      for (const m of current) {
        const row = engagementByDate.get(m.captured_on) ?? { impressions: 0, engagements: 0 };
        row.impressions += m.impressions;
        row.engagements += m.engagements;
        engagementByDate.set(m.captured_on, row);
      }
      const engagementSeries = [...engagementByDate.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, values]) => ({ date, ...values }));

      // --- Totals and comparison ---
      const totals = summarise(current);
      const priorTotals = summarise(previous);

      setState({
        accounts,
        platforms,
        followerSeries,
        engagementSeries,
        totals,
        deltas: {
          followers: percentChange(totals.followers, priorTotals.followers),
          impressions: percentChange(totals.impressions, priorTotals.impressions),
          engagements: percentChange(totals.engagements, priorTotals.engagements),
          engagementRate: percentChange(totals.engagementRate, priorTotals.engagementRate),
        },
        tasks: (tasksRes.data ?? []) as Task[],
        trends: (trendsRes.data ?? []) as TrendingTopic[],
        loading: false,
        error: null,
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : 'Could not load dashboard data.',
      }));
    }
  }, [windowDays]);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, reload: load };
}

/**
 * Followers are a point-in-time stock, so the total is the most recent reading
 * per account. Impressions and engagements are flows, so they sum over the
 * window.
 */
function summarise(
  metrics: Array<{ account_id: string; captured_on: string; followers: number; impressions: number; engagements: number }>,
) {
  if (!metrics.length) return { ...EMPTY_TOTALS };

  const latestPerAccount = new Map<string, { captured_on: string; followers: number }>();
  let impressions = 0;
  let engagements = 0;

  for (const m of metrics) {
    impressions += m.impressions;
    engagements += m.engagements;
    const seen = latestPerAccount.get(m.account_id);
    if (!seen || m.captured_on > seen.captured_on) {
      latestPerAccount.set(m.account_id, { captured_on: m.captured_on, followers: m.followers });
    }
  }

  const followers = [...latestPerAccount.values()].reduce((sum, r) => sum + r.followers, 0);

  return {
    followers,
    impressions,
    engagements,
    engagementRate: impressions ? (engagements / impressions) * 100 : 0,
  };
}
