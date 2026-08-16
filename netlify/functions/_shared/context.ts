import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Assembles the standing context the advisor reasons over: who the user is,
 * what they've connected, how those accounts are trending, what's hot on each
 * platform, and what's already on their plate.
 *
 * Rendered as compact Markdown rather than raw JSON — it reads better to the
 * model and costs fewer tokens than pretty-printed objects.
 */

const LOOKBACK_DAYS = 30;

function pct(current: number, previous: number): string {
  if (!previous) return current ? 'new' : 'flat';
  const delta = ((current - previous) / previous) * 100;
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}%`;
}

export async function buildMarketingContext(db: SupabaseClient, userId: string): Promise<string> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);

  const [profileRes, accountsRes, metricsRes, trendsRes, tasksRes, postsRes] = await Promise.all([
    db.from('profiles').select('display_name, niche, audience, goals, timezone').eq('id', userId).maybeSingle(),
    db.from('social_accounts').select('id, platform, handle, is_active, last_synced_at, last_sync_status').eq('user_id', userId),
    db
      .from('account_metrics')
      .select('platform, captured_on, followers, impressions, engagements, profile_views, link_clicks')
      .eq('user_id', userId)
      .gte('captured_on', since)
      .order('captured_on', { ascending: true }),
    db.from('trending_topics').select('platform, topic, score, momentum').order('captured_at', { ascending: false }).order('score', { ascending: false }).limit(25),
    db.from('tasks').select('title, status, priority, platform, effort').eq('user_id', userId).in('status', ['suggested', 'accepted']).order('priority').limit(20),
    db
      .from('posts')
      .select('platform, content, published_at, impressions, likes, comments, shares')
      .eq('user_id', userId)
      .order('published_at', { ascending: false })
      .limit(15),
  ]);

  const lines: string[] = [];

  // --- Who they are ---
  const profile = profileRes.data;
  lines.push('## Operator profile');
  if (profile) {
    lines.push(`- Name: ${profile.display_name ?? 'unknown'}`);
    lines.push(`- Niche: ${profile.niche ?? 'not specified'}`);
    lines.push(`- Target audience: ${profile.audience ?? 'not specified'}`);
    lines.push(`- Stated goals: ${profile.goals ?? 'not specified'}`);
    lines.push(`- Timezone: ${profile.timezone ?? 'UTC'}`);
  } else {
    lines.push('- No profile on file yet. Ask about niche, audience, and goals before giving specific advice.');
  }

  // --- Connected accounts ---
  const accounts = accountsRes.data ?? [];
  lines.push('', '## Connected accounts');
  if (!accounts.length) {
    lines.push('- None connected. The highest-value first step is connecting at least one account.');
  } else {
    for (const a of accounts) {
      const state = !a.is_active
        ? 'needs reconnect'
        : a.last_sync_status === 'error'
          ? 'last sync failed'
          : a.last_synced_at
            ? `synced ${a.last_synced_at.slice(0, 10)}`
            : 'never synced';
      lines.push(`- ${a.platform} @${a.handle} (${state})`);
    }
  }

  // --- Metric trajectory, per platform ---
  const metrics = metricsRes.data ?? [];
  lines.push('', `## Metrics (last ${LOOKBACK_DAYS} days)`);
  if (!metrics.length) {
    lines.push('- No metric history yet. Avoid claiming trends you cannot see.');
  } else {
    const byPlatform = new Map<string, typeof metrics>();
    for (const m of metrics) {
      const bucket = byPlatform.get(m.platform) ?? [];
      bucket.push(m);
      byPlatform.set(m.platform, bucket);
    }
    for (const [platform, rows] of byPlatform) {
      const first = rows[0];
      const last = rows[rows.length - 1];
      const impressions = rows.reduce((sum, r) => sum + (r.impressions ?? 0), 0);
      const engagements = rows.reduce((sum, r) => sum + (r.engagements ?? 0), 0);
      const rate = impressions ? ((engagements / impressions) * 100).toFixed(2) : 'n/a';
      lines.push(
        `- ${platform}: followers ${last.followers} (${pct(last.followers, first.followers)} over window), ` +
          `${impressions} impressions, ${engagements} engagements, engagement rate ${rate}%`,
      );
    }
  }

  // --- Recent posts ---
  const posts = postsRes.data ?? [];
  if (posts.length) {
    lines.push('', '## Recent posts (newest first)');
    for (const p of posts.slice(0, 8)) {
      const snippet = (p.content ?? '').replace(/\s+/g, ' ').slice(0, 110);
      const engagement = (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0);
      lines.push(`- [${p.platform} ${p.published_at.slice(0, 10)}] "${snippet}" — ${p.impressions} impressions, ${engagement} engagements`);
    }
  }

  // --- Trends ---
  const trends = trendsRes.data ?? [];
  lines.push('', '## Trending now');
  if (!trends.length) {
    lines.push('- No trend data captured yet.');
  } else {
    for (const t of trends.slice(0, 15)) {
      const momentum = t.momentum == null ? '' : ` (${t.momentum > 0 ? '+' : ''}${t.momentum}% momentum)`;
      lines.push(`- [${t.platform}] ${t.topic} — score ${t.score}${momentum}`);
    }
  }

  // --- Open work ---
  const tasks = tasksRes.data ?? [];
  lines.push('', '## Open tasks');
  if (!tasks.length) {
    lines.push('- Nothing queued.');
  } else {
    for (const t of tasks) {
      lines.push(`- [P${t.priority} ${t.status} ${t.effort}] ${t.title}${t.platform ? ` (${t.platform})` : ''}`);
    }
  }

  return lines.join('\n');
}
