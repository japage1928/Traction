import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useDashboardData } from '@/hooks/useDashboardData';
import { StatTile } from '@/components/charts/StatTile';
import { FollowerTrendChart } from '@/components/charts/FollowerTrendChart';
import { EngagementChart } from '@/components/charts/EngagementChart';
import { TrendingTopics } from '@/components/TrendingTopics';
import { TaskQueue } from '@/components/TaskQueue';
import { PageHeader, Section, Banner } from '@/components/ui';
import { generateBrief, syncAccounts } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { formatPercent } from '@/lib/format';

const WINDOWS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

export function Dashboard() {
  const { profile } = useAuth();
  const [windowDays, setWindowDays] = useState(30);
  const data = useDashboardData(windowDays);

  const [busy, setBusy] = useState<'sync' | 'brief' | null>(null);
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [brief, setBrief] = useState<{ headline: string; summary: string } | null>(null);

  async function handleSync() {
    setBusy('sync');
    setMessage(null);
    try {
      const result = await syncAccounts();
      await data.reload();
      setMessage(
        result.failed
          ? { tone: 'bad', text: `Synced ${result.synced}, ${result.failed} failed. See Accounts for details.` }
          : { tone: 'good', text: `Synced ${result.synced} account${result.synced === 1 ? '' : 's'}.` },
      );
    } catch (err) {
      setMessage({ tone: 'bad', text: err instanceof Error ? err.message : 'Sync failed.' });
    } finally {
      setBusy(null);
    }
  }

  async function handleBrief() {
    setBusy('brief');
    setMessage(null);
    try {
      const result = await generateBrief();
      setBrief({ headline: result.headline, summary: result.summary });
      await data.reload();
    } catch (err) {
      setMessage({ tone: 'bad', text: err instanceof Error ? err.message : 'Could not generate a briefing.' });
    } finally {
      setBusy(null);
    }
  }

  const noAccounts = !data.loading && data.accounts.length === 0;
  const greeting = profile?.display_name ? `Morning, ${profile.display_name.split(' ')[0]}` : 'Dashboard';

  return (
    <div className="mx-auto max-w-6xl px-5 py-6 md:px-8 md:py-8">
      <PageHeader
        title={greeting}
        subtitle="Where your distribution stands, and what to do about it."
        actions={
          <>
            <div className="flex rounded-lg border border-line p-0.5">
              {WINDOWS.map((w) => (
                <button
                  key={w.days}
                  type="button"
                  onClick={() => setWindowDays(w.days)}
                  className={[
                    'rounded-md px-2.5 py-1 text-xs transition-colors',
                    windowDays === w.days ? 'bg-surface-sunken font-medium text-ink' : 'text-ink-secondary',
                  ].join(' ')}
                >
                  {w.label}
                </button>
              ))}
            </div>
            <button type="button" className="btn-ghost text-xs" onClick={() => void handleSync()} disabled={busy !== null}>
              {busy === 'sync' ? 'Syncing…' : 'Sync now'}
            </button>
            <button type="button" className="btn-primary text-xs" onClick={() => void handleBrief()} disabled={busy !== null}>
              {busy === 'brief' ? 'Thinking…' : 'Daily briefing'}
            </button>
          </>
        }
      />

      {message && (
        <Banner tone={message.tone === 'good' ? 'good' : 'critical'} className="mt-4">
          {message.text}
        </Banner>
      )}

      {data.error && (
        <Banner tone="critical" className="mt-4">
          {data.error}
        </Banner>
      )}

      {noAccounts && (
        <Banner tone="info" className="mt-4">
          No accounts connected yet.{' '}
          <Link to="/account" className="font-medium underline">
            Connect one
          </Link>{' '}
          and Traction can start tracking what’s working.
        </Banner>
      )}

      {brief && (
        <div className="card mt-6 p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">Today’s briefing</div>
          <h2 className="mt-2 text-lg font-semibold leading-snug text-ink">{brief.headline}</h2>
          <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-secondary">
            {brief.summary.split(/\n{2,}/).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        </div>
      )}

      {/* --- Headline numbers --- */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Followers" value={data.totals.followers} delta={data.deltas.followers} />
        <StatTile label="Impressions" value={data.totals.impressions} delta={data.deltas.impressions} />
        <StatTile label="Engagements" value={data.totals.engagements} delta={data.deltas.engagements} />
        <EngagementRateTile rate={data.totals.engagementRate} delta={data.deltas.engagementRate} />
      </div>

      {/* --- Charts --- */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Section title="Follower growth" subtitle={`Last ${windowDays} days, by platform`}>
          <FollowerTrendChart data={data.followerSeries} platforms={data.platforms} />
        </Section>

        <Section title="Reach and interaction" subtitle={`Last ${windowDays} days, all platforms`}>
          <EngagementChart data={data.engagementSeries} />
        </Section>
      </div>

      {/* --- Next actions and trends --- */}
      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Section
            title="What to do next"
            subtitle="Queued by the advisor, highest priority first"
            action={
              <Link to="/advisor" className="text-xs text-ink-secondary hover:text-ink">
                Ask the advisor →
              </Link>
            }
          >
            <TaskQueue tasks={data.tasks} onChange={() => void data.reload()} />
          </Section>
        </div>

        <div className="lg:col-span-2">
          <Section
            title="Trending now"
            subtitle="Across your platforms"
            action={
              <Link to="/trends" className="text-xs text-ink-secondary hover:text-ink">
                See all →
              </Link>
            }
          >
            <TrendingTopics topics={data.trends} />
          </Section>
        </div>
      </div>
    </div>
  );
}

/**
 * Engagement rate is a percentage, so it needs its own tile rather than the
 * compact-number formatting the others use.
 */
function EngagementRateTile({ rate, delta }: { rate: number; delta: number | null }) {
  const hasDelta = delta != null && Number.isFinite(delta);
  const isUp = hasDelta && delta > 0;

  return (
    <div className="card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">Engagement rate</div>
      <div className="mt-2 text-3xl font-semibold leading-none text-ink">{formatPercent(rate, 2)}</div>
      {hasDelta ? (
        <div
          className="mt-2 flex items-center gap-1.5 text-xs"
          style={{ color: isUp ? 'var(--delta-up)' : 'var(--delta-down)' }}
        >
          <span aria-hidden>{isUp ? '↑' : '↓'}</span>
          <span className="tabular font-medium">
            {isUp ? '+' : ''}
            {delta.toFixed(1)}%
          </span>
          <span className="sr-only">{isUp ? 'up' : 'down'}</span>
          <span className="text-ink-muted">vs previous period</span>
        </div>
      ) : (
        <div className="mt-2 text-xs text-ink-muted">engagements ÷ impressions</div>
      )}
    </div>
  );
}
