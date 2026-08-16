/**
 * Types shared by the browser bundle and the Netlify Functions.
 * Keep this file dependency-free so both runtimes can import it.
 */

export const PLATFORMS = ['x', 'linkedin', 'reddit', 'youtube', 'instagram', 'tiktok', 'pinterest'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABELS: Record<Platform, string> = {
  x: 'X',
  linkedin: 'LinkedIn',
  reddit: 'Reddit',
  youtube: 'YouTube',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  pinterest: 'Pinterest',
};

export type SyncStatus = 'pending' | 'running' | 'success' | 'error';

/**
 * Lifecycle of a social connection, distinct from sync health.
 *
 *  - connected            working
 *  - needs_reauthorization the grant is gone (revoked, expired, scope removed);
 *                          only the user can fix it, by reconnecting
 *  - error                 transient trouble; retrying may succeed
 *  - disconnected          retained for history, no live credentials
 */
export type ConnectionStatus = 'connected' | 'needs_reauthorization' | 'error' | 'disconnected';

export const CONNECTION_STATUS_LABELS: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  needs_reauthorization: 'Needs reauthorization',
  error: 'Connection error',
  disconnected: 'Disconnected',
};
export type TaskStatus = 'suggested' | 'accepted' | 'done' | 'dismissed';
export type TaskEffort = 'quick' | 'medium' | 'deep';

export interface Profile {
  id: string;
  display_name: string | null;
  niche: string | null;
  audience: string | null;
  goals: string | null;
  timezone: string;
  onboarded_at: string | null;
}

export interface SocialAccount {
  id: string;
  user_id: string;
  platform: Platform;
  external_id: string;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_url: string | null;
  scopes: string[];
  connected_at: string;
  last_synced_at: string | null;
  last_sync_status: SyncStatus;
  last_sync_error: string | null;
  is_active: boolean;
  status: ConnectionStatus;
  /** User-facing explanation. Never carries tokens, secrets, or raw API bodies. */
  status_detail: string | null;
  needs_reauth_since: string | null;
  last_authorized_at: string | null;
}

/** Non-sensitive platform detail, safe to render in the browser. */
export interface SocialAccountMetadata {
  account_id: string;
  platform: Platform;
  data: Record<string, unknown>;
  captured_at: string;
}

export interface AccountMetric {
  id: string;
  account_id: string;
  platform: Platform;
  captured_on: string;
  followers: number;
  following: number;
  posts_count: number;
  impressions: number;
  engagements: number;
  profile_views: number;
  link_clicks: number;
}

export interface Post {
  id: string;
  account_id: string;
  platform: Platform;
  external_id: string;
  content: string | null;
  url: string | null;
  published_at: string;
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  clicks: number;
}

export interface TrendingTopic {
  id: string;
  platform: Platform;
  topic: string;
  score: number;
  momentum: number | null;
  volume: number | null;
  region: string;
  url: string | null;
  captured_at: string;
}

export interface Task {
  id: string;
  user_id: string;
  title: string;
  detail: string | null;
  rationale: string | null;
  platform: Platform | null;
  effort: TaskEffort;
  priority: number;
  status: TaskStatus;
  due_on: string | null;
  source: string;
  created_at: string;
  completed_at: string | null;
}

export interface AdvisorThread {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface AdvisorMessage {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

/** A single point on the dashboard's time-series charts. */
export interface TimeseriesPoint {
  date: string;
  [seriesKey: string]: string | number;
}

/** Server-sent event frames emitted by the /advisor function. */
export type AdvisorEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking' }
  | { type: 'tool'; name: string }
  | { type: 'tasks'; tasks: Array<Omit<Task, 'id' | 'user_id' | 'created_at' | 'completed_at'>> }
  | { type: 'done'; threadId: string }
  | { type: 'error'; message: string };
