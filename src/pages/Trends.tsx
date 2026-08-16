import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { refreshTrends } from '@/lib/api';
import { TrendingTopics } from '@/components/TrendingTopics';
import { PageHeader, Section, Banner, Spinner } from '@/components/ui';
import { formatRelative } from '@/lib/format';
import { PLATFORM_LABELS, type Platform, type TrendingTopic } from '@shared/types';

export function Trends() {
  const [topics, setTopics] = useState<TrendingTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Platform | 'all'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: queryError } = await supabase
      .from('trending_topics')
      .select('*')
      .order('captured_at', { ascending: false })
      .order('score', { ascending: false })
      .limit(60);

    if (queryError) setError(queryError.message);
    else setTopics((data as TrendingTopic[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      await refreshTrends();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not refresh trends.');
    } finally {
      setRefreshing(false);
    }
  }

  // Only show the most recent capture, so a stale run doesn't pad the list.
  const latest = useMemo(() => {
    if (!topics.length) return [];
    const newest = topics[0].captured_at;
    return topics.filter((t) => t.captured_at === newest);
  }, [topics]);

  const platforms = useMemo(() => [...new Set(latest.map((t) => t.platform))], [latest]);
  const visible = filter === 'all' ? latest : latest.filter((t) => t.platform === filter);
  const capturedAt = latest[0]?.captured_at ?? null;

  return (
    <div className="mx-auto max-w-4xl px-5 py-6 md:px-8 md:py-8">
      <PageHeader
        title="Trends"
        subtitle={
          capturedAt
            ? `Last scanned ${formatRelative(capturedAt)}. Scoped to your niche.`
            : 'What’s moving across your platforms right now.'
        }
        actions={
          <button type="button" className="btn-primary text-xs" onClick={() => void handleRefresh()} disabled={refreshing}>
            {refreshing ? 'Scanning the web…' : 'Refresh trends'}
          </button>
        }
      />

      {error && (
        <Banner tone="critical" className="mt-4">
          {error}
        </Banner>
      )}

      {platforms.length > 1 && (
        <div className="mt-5 flex flex-wrap gap-1.5">
          <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
            All
          </FilterChip>
          {platforms.map((platform) => (
            <FilterChip key={platform} active={filter === platform} onClick={() => setFilter(platform)}>
              {PLATFORM_LABELS[platform]}
            </FilterChip>
          ))}
        </div>
      )}

      <div className="mt-5">
        <Section title="Trending topics" subtitle="Ranked by current attention">
          {loading ? <Spinner /> : <TrendingTopics topics={visible} />}
        </Section>
      </div>

      <p className="mt-4 px-1 text-xs text-ink-muted">
        Trends are found by searching the live web, then scored and filtered against the niche in your settings.
        A more specific niche produces sharper results.
      </p>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-full border px-3 py-1 text-xs transition-colors',
        active ? 'border-transparent bg-surface font-medium text-ink' : 'border-line text-ink-secondary hover:bg-surface',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
