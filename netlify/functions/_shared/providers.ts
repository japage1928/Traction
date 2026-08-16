import type { Platform } from '../../../shared/types.js';
import { appUrl } from './http.js';

/**
 * Provider registry — OAuth 2.0 only.
 *
 * Traction never handles a user's platform password and never asks for a
 * platform API key. Every connection is an authorization-code grant performed
 * on the provider's own domain; we only ever receive tokens.
 *
 * Two rules shape this file:
 *
 *  1. **Least privilege.** Every provider requests read-only scopes, and each
 *     metric source declares the scopes it needs. A source whose scopes were
 *     not granted is skipped rather than attempted — so a partial consent
 *     yields partial data, never a failed sync or an unauthorized call.
 *
 *  2. **PKCE wherever the provider supports it.** The authorization code is
 *     bound to a one-time verifier that never leaves our server.
 */

export interface ProviderProfile {
  externalId: string;
  handle: string;
  displayName?: string;
  avatarUrl?: string;
  profileUrl?: string;
}

/** A point-in-time reading of an account, normalised across platforms. */
export interface ProviderMetrics {
  followers: number;
  following: number;
  postsCount: number;
  impressions: number;
  engagements: number;
  profileViews: number;
  linkClicks: number;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  /** Scopes the provider actually granted, which may be fewer than requested. */
  scopes: string[];
}

interface FetchContext {
  accessToken: string;
  profile: ProviderProfile;
}

/**
 * One scope-gated slice of an account's metrics. Splitting metrics this way is
 * what lets a partial consent degrade gracefully: we run the sources the user
 * authorized and skip the rest.
 */
export interface MetricSource {
  id: string;
  label: string;
  /** Every scope here must be present in the granted set for this to run. */
  scopes: string[];
  fetch: (ctx: FetchContext) => Promise<Partial<ProviderMetrics>>;
}

/**
 * A capability Traction does not have yet, and the scopes it would require.
 *
 * Recorded rather than requested. Asking for publishing permission before
 * anything can publish trains users to grant more than the product uses, and
 * makes the consent screen misrepresent what the app does. When a capability
 * ships, move its scopes into the provider's `scopes` array and prompt the
 * affected users to re-authorize.
 */
export interface FutureCapability {
  capability: 'read_analytics' | 'create_drafts' | 'publish' | 'schedule' | 'reply' | 'media_upload';
  scopes: string[];
  /** False when the platform's public API genuinely cannot do this. */
  supportedByPlatform: boolean;
  note?: string;
}

export interface ProviderDefinition {
  platform: Platform;
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  revokeUrl?: string;
  /**
   * Read-only scopes actually requested at authorize time. Kept to the minimum
   * the product uses today: identity, plus the reads the dashboard already
   * renders. Anything speculative belongs in `futureCapabilities` instead.
   */
  scopes: string[];
  /** Subset of `scopes` required just to identify the account. */
  profileScopes: string[];
  /** Documented, deliberately NOT requested. See FutureCapability. */
  futureCapabilities: FutureCapability[];
  usesPkce: boolean;
  /** Send client credentials as HTTP Basic on the token endpoint. */
  usesBasicAuth: boolean;
  /** Most providers use `client_id`; TikTok uses `client_key`. */
  clientIdParam: string;
  /** Most providers space-separate scopes; Reddit, TikTok and Instagram use commas. */
  scopeSeparator: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  extraAuthorizeParams?: Record<string, string>;
  fetchProfile: (accessToken: string) => Promise<ProviderProfile>;
  metricSources: MetricSource[];
  /** Runs after the code exchange — used where a second hop is required. */
  postExchange?: (tokens: TokenSet) => Promise<TokenSet>;
  /** Overrides the standard refresh_token grant. */
  refresh?: (tokens: TokenSet) => Promise<TokenSet>;
  /** Overrides the standard RFC 7009 revocation call. */
  revoke?: (tokens: TokenSet) => Promise<void>;
  /** Shown in the UI so the user knows what they are consenting to. */
  permissionSummary: string;
}

const USER_AGENT = 'Traction/0.1 (marketing analytics)';

async function getJson(url: string, accessToken: string, extraHeaders: Record<string, string> = {}) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': USER_AGENT, ...extraHeaders },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${new URL(url).host} responded ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

function clientCreds(provider: ProviderDefinition): { id: string; secret: string } {
  const id = process.env[provider.clientIdEnv];
  const secret = process.env[provider.clientSecretEnv];
  if (!id || !secret) {
    throw new Error(`${provider.label} is not configured: set ${provider.clientIdEnv} and ${provider.clientSecretEnv}.`);
  }
  return { id, secret };
}

// ---------------------------------------------------------------------------
// X (Twitter) — OAuth 2.0 + PKCE
// ---------------------------------------------------------------------------

const x: ProviderDefinition = {
  platform: 'x',
  label: 'X',
  authorizeUrl: 'https://twitter.com/i/oauth2/authorize',
  tokenUrl: 'https://api.twitter.com/2/oauth2/token',
  revokeUrl: 'https://api.x.com/2/oauth2/revoke',
  scopes: ['tweet.read', 'users.read', 'offline.access'],
  profileScopes: ['users.read'],
  usesPkce: true,
  usesBasicAuth: true,
  clientIdParam: 'client_id',
  scopeSeparator: ' ',
  clientIdEnv: 'X_CLIENT_ID',
  clientSecretEnv: 'X_CLIENT_SECRET',
  permissionSummary: 'Read your profile and public post metrics. Cannot post, like, or follow.',
  futureCapabilities: [
    { capability: 'publish', scopes: ['tweet.write'], supportedByPlatform: true },
    { capability: 'reply', scopes: ['tweet.write'], supportedByPlatform: true },
    { capability: 'media_upload', scopes: ['media.write'], supportedByPlatform: true },
    {
      capability: 'read_analytics',
      scopes: ['tweet.read'],
      supportedByPlatform: true,
      note: 'Per-post organic impressions require a paid X API tier; the free tier exposes public metrics only.',
    },
    {
      capability: 'schedule',
      scopes: [],
      supportedByPlatform: false,
      note: 'X has no scheduling endpoint. Traction would hold the queue and post at the target time.',
    },
  ],
  async fetchProfile(accessToken) {
    const data = await getJson(
      'https://api.x.com/2/users/me?user.fields=public_metrics,profile_image_url,username,name',
      accessToken,
    );
    const u = data.data;
    return {
      externalId: u.id,
      handle: u.username,
      displayName: u.name,
      avatarUrl: u.profile_image_url,
      profileUrl: `https://x.com/${u.username}`,
    };
  },
  metricSources: [
    {
      id: 'audience',
      label: 'Follower counts',
      scopes: ['users.read'],
      async fetch({ accessToken }) {
        const data = await getJson('https://api.x.com/2/users/me?user.fields=public_metrics', accessToken);
        const m = data.data?.public_metrics ?? {};
        return {
          followers: m.followers_count ?? 0,
          following: m.following_count ?? 0,
          postsCount: m.tweet_count ?? 0,
        };
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Reddit — OAuth 2.0 (no PKCE support)
// ---------------------------------------------------------------------------

const reddit: ProviderDefinition = {
  platform: 'reddit',
  label: 'Reddit',
  authorizeUrl: 'https://www.reddit.com/api/v1/authorize',
  tokenUrl: 'https://www.reddit.com/api/v1/access_token',
  revokeUrl: 'https://www.reddit.com/api/v1/revoke_token',
  scopes: ['identity', 'history', 'read'],
  profileScopes: ['identity'],
  usesPkce: false,
  usesBasicAuth: true,
  clientIdParam: 'client_id',
  // Reddit's authorize endpoint expects a comma-separated scope list.
  scopeSeparator: ',',
  clientIdEnv: 'REDDIT_CLIENT_ID',
  clientSecretEnv: 'REDDIT_CLIENT_SECRET',
  // `duration=permanent` is what makes Reddit issue a refresh token at all.
  extraAuthorizeParams: { duration: 'permanent' },
  permissionSummary: 'Read your username, karma, and post history. Cannot post, vote, or comment.',
  futureCapabilities: [
    { capability: 'publish', scopes: ['submit'], supportedByPlatform: true },
    { capability: 'reply', scopes: ['submit'], supportedByPlatform: true },
    {
      capability: 'schedule',
      scopes: [],
      supportedByPlatform: false,
      note: 'Reddit has no scheduling endpoint; Traction would hold the queue itself.',
    },
  ],
  async fetchProfile(accessToken) {
    const u = await getJson('https://oauth.reddit.com/api/v1/me', accessToken);
    return {
      externalId: u.id,
      handle: u.name,
      displayName: u.subreddit?.title ?? u.name,
      avatarUrl: (u.icon_img ?? '').split('?')[0] || undefined,
      profileUrl: `https://reddit.com/user/${u.name}`,
    };
  },
  metricSources: [
    {
      id: 'audience',
      label: 'Karma and subscribers',
      scopes: ['identity'],
      async fetch({ accessToken }) {
        const u = await getJson('https://oauth.reddit.com/api/v1/me', accessToken);
        return {
          followers: u.subreddit?.subscribers ?? 0,
          // Reddit exposes no impression metric; karma is the closest proxy.
          engagements: (u.link_karma ?? 0) + (u.comment_karma ?? 0),
        };
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// YouTube (Google) — OAuth 2.0 + PKCE
// ---------------------------------------------------------------------------

const youtube: ProviderDefinition = {
  platform: 'youtube',
  label: 'YouTube',
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  revokeUrl: 'https://oauth2.googleapis.com/revoke',
  scopes: ['https://www.googleapis.com/auth/youtube.readonly'],
  profileScopes: ['https://www.googleapis.com/auth/youtube.readonly'],
  usesPkce: true,
  usesBasicAuth: false,
  clientIdParam: 'client_id',
  scopeSeparator: ' ',
  clientIdEnv: 'YOUTUBE_CLIENT_ID',
  clientSecretEnv: 'YOUTUBE_CLIENT_SECRET',
  // Google only issues a refresh token when both of these are present.
  extraAuthorizeParams: { access_type: 'offline', prompt: 'consent' },
  permissionSummary: 'Read your channel details and public statistics. Cannot upload, edit, or delete.',
  futureCapabilities: [
    {
      capability: 'publish',
      scopes: ['https://www.googleapis.com/auth/youtube.upload'],
      supportedByPlatform: true,
    },
    {
      capability: 'read_analytics',
      scopes: ['https://www.googleapis.com/auth/yt-analytics.readonly'],
      supportedByPlatform: true,
      note: 'Watch time and traffic sources need the YouTube Analytics API, a separate scope.',
    },
  ],
  async fetchProfile(accessToken) {
    const data = await getJson(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
      accessToken,
    );
    const c = data.items?.[0];
    if (!c) throw new Error('This Google account has no YouTube channel.');
    return {
      externalId: c.id,
      handle: c.snippet.customUrl ?? c.snippet.title,
      displayName: c.snippet.title,
      avatarUrl: c.snippet.thumbnails?.default?.url,
      profileUrl: `https://youtube.com/channel/${c.id}`,
    };
  },
  metricSources: [
    {
      id: 'audience',
      label: 'Channel statistics',
      scopes: ['https://www.googleapis.com/auth/youtube.readonly'],
      async fetch({ accessToken }) {
        const data = await getJson(
          'https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true',
          accessToken,
        );
        const s = data.items?.[0]?.statistics ?? {};
        return {
          followers: Number(s.subscriberCount ?? 0),
          postsCount: Number(s.videoCount ?? 0),
          impressions: Number(s.viewCount ?? 0),
        };
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// LinkedIn — OAuth 2.0 + PKCE
//
// Member-level analytics need the Community Management API, which LinkedIn
// grants only to approved partners. With the default OpenID scopes we can
// identify the account but not read follower or impression counts, so the
// audience source below is gated on a scope most apps will not hold and is
// simply skipped until approval comes through.
// ---------------------------------------------------------------------------

const linkedin: ProviderDefinition = {
  platform: 'linkedin',
  label: 'LinkedIn',
  authorizeUrl: 'https://www.linkedin.com/oauth/v2/authorization',
  tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
  revokeUrl: 'https://www.linkedin.com/oauth/v2/revoke',
  scopes: ['openid', 'profile', 'email'],
  profileScopes: ['profile'],
  // LinkedIn's authorization-code flow does not document PKCE support and its
  // authorize endpoint validates parameters strictly, so we don't send a
  // challenge it may reject. The signed-state cookie is the CSRF defence here.
  usesPkce: false,
  usesBasicAuth: false,
  clientIdParam: 'client_id',
  scopeSeparator: ' ',
  clientIdEnv: 'LINKEDIN_CLIENT_ID',
  clientSecretEnv: 'LINKEDIN_CLIENT_SECRET',
  permissionSummary: 'Read your name, headline, and profile photo. Cannot post or message.',
  futureCapabilities: [
    { capability: 'publish', scopes: ['w_member_social'], supportedByPlatform: true },
    {
      capability: 'read_analytics',
      scopes: ['r_organization_social'],
      supportedByPlatform: true,
      note: 'Requires LinkedIn partner approval for the Community Management API.',
    },
  ],
  async fetchProfile(accessToken) {
    const u = await getJson('https://api.linkedin.com/v2/userinfo', accessToken);
    return {
      externalId: u.sub,
      handle: u.email ?? u.name,
      displayName: u.name,
      avatarUrl: u.picture,
      profileUrl: 'https://www.linkedin.com/in/me',
    };
  },
  metricSources: [
    {
      id: 'audience',
      label: 'Follower statistics',
      // Only held by apps approved for the Community Management API.
      scopes: ['r_organization_social'],
      async fetch({ accessToken, profile }) {
        const data = await getJson(
          `https://api.linkedin.com/rest/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=urn:li:organization:${profile.externalId}`,
          accessToken,
          { 'LinkedIn-Version': '202405', 'X-Restli-Protocol-Version': '2.0.0' },
        );
        const counts = data.elements?.[0]?.followerCountsByAssociationType ?? [];
        const followers = counts.reduce(
          (sum: number, c: { followerCounts?: { organicFollowerCount?: number } }) =>
            sum + (c.followerCounts?.organicFollowerCount ?? 0),
          0,
        );
        return { followers };
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Instagram — OAuth 2.0 via Instagram Login (business/creator accounts)
//
// Instagram is the odd one out in two ways. The code exchange returns a
// short-lived token that must be swapped for a long-lived one, and there is no
// refresh token: the long-lived token refreshes itself. Both are handled by the
// postExchange and refresh hooks rather than by bending the standard path.
// ---------------------------------------------------------------------------

const INSTAGRAM_GRAPH = 'https://graph.instagram.com/v23.0';

const instagram: ProviderDefinition = {
  platform: 'instagram',
  label: 'Instagram',
  authorizeUrl: 'https://www.instagram.com/oauth/authorize',
  tokenUrl: 'https://api.instagram.com/oauth/access_token',
  scopes: ['instagram_business_basic', 'instagram_business_manage_insights'],
  profileScopes: ['instagram_business_basic'],
  usesPkce: false,
  usesBasicAuth: false,
  clientIdParam: 'client_id',
  scopeSeparator: ',',
  clientIdEnv: 'INSTAGRAM_CLIENT_ID',
  clientSecretEnv: 'INSTAGRAM_CLIENT_SECRET',
  permissionSummary: 'Read your profile, media list, and insights. Cannot post, comment, or send messages.',
  futureCapabilities: [
    { capability: 'publish', scopes: ['instagram_business_content_publish'], supportedByPlatform: true },
    { capability: 'reply', scopes: ['instagram_business_manage_comments'], supportedByPlatform: true },
  ],

  async postExchange(tokens) {
    // Swap the 1-hour token for a 60-day one before we ever store it.
    const { secret } = clientCreds(instagram);
    const url = new URL('https://graph.instagram.com/access_token');
    url.searchParams.set('grant_type', 'ig_exchange_token');
    url.searchParams.set('client_secret', secret);
    url.searchParams.set('access_token', tokens.accessToken);

    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) {
      throw new Error(`Instagram long-lived token exchange failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    const data = await res.json();
    return {
      ...tokens,
      accessToken: data.access_token,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
    };
  },

  async refresh(tokens) {
    const url = new URL('https://graph.instagram.com/refresh_access_token');
    url.searchParams.set('grant_type', 'ig_refresh_token');
    url.searchParams.set('access_token', tokens.accessToken);

    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) {
      throw new Error(
        `Instagram token refresh failed (${res.status}). Long-lived tokens expire after 60 days of inactivity — reconnect the account.`,
      );
    }
    const data = await res.json();
    return {
      ...tokens,
      accessToken: data.access_token,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
    };
  },

  async fetchProfile(accessToken) {
    const u = await getJson(
      `${INSTAGRAM_GRAPH}/me?fields=id,username,account_type,profile_picture_url`,
      accessToken,
    );
    return {
      externalId: u.id,
      handle: u.username,
      displayName: u.username,
      avatarUrl: u.profile_picture_url,
      profileUrl: `https://instagram.com/${u.username}`,
    };
  },

  metricSources: [
    {
      id: 'audience',
      label: 'Followers and media count',
      scopes: ['instagram_business_basic'],
      async fetch({ accessToken }) {
        const u = await getJson(`${INSTAGRAM_GRAPH}/me?fields=followers_count,media_count`, accessToken);
        return { followers: u.followers_count ?? 0, postsCount: u.media_count ?? 0 };
      },
    },
    {
      id: 'insights',
      label: 'Reach and profile views',
      scopes: ['instagram_business_manage_insights'],
      async fetch({ accessToken }) {
        const data = await getJson(
          `${INSTAGRAM_GRAPH}/me/insights?metric=reach,profile_views&period=day&metric_type=total_value`,
          accessToken,
        );
        const read = (name: string) =>
          data.data?.find((d: { name: string }) => d.name === name)?.total_value?.value ?? 0;
        return { impressions: read('reach'), profileViews: read('profile_views') };
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// TikTok — OAuth 2.0 + PKCE (Login Kit v2)
//
// TikTok names its client id `client_key`, comma-separates scopes, and splits
// profile fields across three scopes — which makes it the clearest case for
// per-source scope gating.
// ---------------------------------------------------------------------------

const TIKTOK_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';

const tiktok: ProviderDefinition = {
  platform: 'tiktok',
  label: 'TikTok',
  authorizeUrl: 'https://www.tiktok.com/v2/auth/authorize/',
  tokenUrl: TIKTOK_TOKEN_URL,
  revokeUrl: 'https://open.tiktokapis.com/v2/oauth/revoke/',
  scopes: ['user.info.basic', 'user.info.profile', 'user.info.stats'],
  profileScopes: ['user.info.basic'],
  usesPkce: true,
  usesBasicAuth: false,
  clientIdParam: 'client_key',
  scopeSeparator: ',',
  clientIdEnv: 'TIKTOK_CLIENT_KEY',
  clientSecretEnv: 'TIKTOK_CLIENT_SECRET',
  permissionSummary: 'Read your profile and follower statistics. Cannot post videos or read your inbox.',
  futureCapabilities: [
    { capability: 'publish', scopes: ['video.publish'], supportedByPlatform: true },
    { capability: 'media_upload', scopes: ['video.upload'], supportedByPlatform: true },
    {
      capability: 'read_analytics',
      scopes: ['video.list'],
      supportedByPlatform: true,
      note: 'Per-video metrics come from the video list endpoint.',
    },
  ],

  async fetchProfile(accessToken) {
    const data = await getJson(
      'https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name,username',
      accessToken,
    );
    const u = data.data?.user;
    if (!u) throw new Error('TikTok returned no user record.');
    return {
      externalId: u.open_id,
      handle: u.username ?? u.open_id,
      displayName: u.display_name,
      avatarUrl: u.avatar_url,
      profileUrl: u.username ? `https://tiktok.com/@${u.username}` : undefined,
    };
  },

  metricSources: [
    {
      id: 'audience',
      label: 'Follower and video statistics',
      scopes: ['user.info.stats'],
      async fetch({ accessToken }) {
        const data = await getJson(
          'https://open.tiktokapis.com/v2/user/info/?fields=follower_count,following_count,likes_count,video_count',
          accessToken,
        );
        const u = data.data?.user ?? {};
        return {
          followers: u.follower_count ?? 0,
          following: u.following_count ?? 0,
          postsCount: u.video_count ?? 0,
          engagements: u.likes_count ?? 0,
        };
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Pinterest — OAuth 2.0 + PKCE (API v5)
//
// `user_accounts:read` covers both identity and the follower/pin counts the
// dashboard shows, so no second scope is needed to reach parity with the other
// platforms. Pinterest publishes no token-revocation endpoint, so disconnect
// deletes locally and tells the user to finish in Pinterest's own settings.
// ---------------------------------------------------------------------------

const PINTEREST_API = 'https://api.pinterest.com/v5';

const pinterest: ProviderDefinition = {
  platform: 'pinterest',
  label: 'Pinterest',
  authorizeUrl: 'https://www.pinterest.com/oauth/',
  tokenUrl: `${PINTEREST_API}/oauth/token`,
  scopes: ['user_accounts:read'],
  profileScopes: ['user_accounts:read'],
  usesPkce: true,
  // Pinterest expects the client credentials as HTTP Basic on /oauth/token.
  usesBasicAuth: true,
  clientIdParam: 'client_id',
  scopeSeparator: ',',
  clientIdEnv: 'PINTEREST_CLIENT_ID',
  clientSecretEnv: 'PINTEREST_CLIENT_SECRET',
  permissionSummary: 'Read your account details and follower counts. Cannot create pins or boards.',
  futureCapabilities: [
    { capability: 'publish', scopes: ['pins:write', 'boards:write'], supportedByPlatform: true },
    {
      capability: 'read_analytics',
      scopes: ['pins:read', 'boards:read'],
      supportedByPlatform: true,
      note: 'Per-pin impressions and saves come from the pin analytics endpoints.',
    },
    {
      capability: 'schedule',
      scopes: [],
      supportedByPlatform: false,
      note: 'Pinterest has no scheduling endpoint on the public v5 API.',
    },
  ],

  async fetchProfile(accessToken) {
    const u = await getJson(`${PINTEREST_API}/user_account`, accessToken);
    // v5 returns `username` reliably; `id` only on some account types.
    const externalId = u.id ?? u.username;
    if (!externalId) throw new Error('Pinterest returned no account identifier.');
    return {
      externalId: String(externalId),
      handle: u.username,
      displayName: u.business_name || u.username,
      avatarUrl: u.profile_image,
      profileUrl: u.username ? `https://pinterest.com/${u.username}` : undefined,
    };
  },

  metricSources: [
    {
      id: 'audience',
      label: 'Follower and pin counts',
      scopes: ['user_accounts:read'],
      async fetch({ accessToken }) {
        const u = await getJson(`${PINTEREST_API}/user_account`, accessToken);
        return {
          followers: u.follower_count ?? 0,
          following: u.following_count ?? 0,
          postsCount: u.pin_count ?? 0,
          // v5 reports rolling 30-day impressions on the account object.
          impressions: u.monthly_views ?? 0,
        };
      },
    },
  ],
};

// ---------------------------------------------------------------------------

export const PROVIDERS: Record<Platform, ProviderDefinition> = {
  x,
  reddit,
  youtube,
  linkedin,
  instagram,
  tiktok,
  pinterest,
};

export function getProvider(platform: string): ProviderDefinition {
  const provider = PROVIDERS[platform as Platform];
  if (!provider) throw new Error(`Unsupported platform: ${platform}`);
  return provider;
}

export function isConfigured(provider: ProviderDefinition): boolean {
  return Boolean(process.env[provider.clientIdEnv] && process.env[provider.clientSecretEnv]);
}

/**
 * Platforms with their own start/callback handlers, reached at the clean
 * `/api/oauth/<platform>/…` paths. Everything else shares the generic pair.
 */
export const DEDICATED_ROUTE_PLATFORMS = new Set<Platform>(['x', 'tiktok', 'pinterest']);

/**
 * The redirect URI sent at authorize time and again at token exchange. Both
 * must match what is registered in the platform's developer console exactly —
 * byte for byte, including the query string on the generic form.
 */
export function redirectUri(platform: Platform): string {
  return DEDICATED_ROUTE_PLATFORMS.has(platform)
    ? `${appUrl()}/api/oauth/${platform}/callback`
    : `${appUrl()}/.netlify/functions/oauth-callback?platform=${platform}`;
}

/** Splits a provider's scope string on whitespace or commas. */
function parseScopes(raw: unknown, fallback: string[]): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string' && raw.trim()) return raw.split(/[\s,]+/).filter(Boolean);
  return fallback;
}

export function buildAuthorizeUrl(
  provider: ProviderDefinition,
  state: string,
  codeChallenge?: string,
): string {
  const { id } = clientCreds(provider);
  const url = new URL(provider.authorizeUrl);

  url.searchParams.set('response_type', 'code');
  url.searchParams.set(provider.clientIdParam, id);
  url.searchParams.set('redirect_uri', redirectUri(provider.platform));
  url.searchParams.set('scope', provider.scopes.join(provider.scopeSeparator));
  url.searchParams.set('state', state);

  if (provider.usesPkce) {
    if (!codeChallenge) throw new Error(`${provider.label} requires PKCE but no challenge was supplied.`);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }

  for (const [k, v] of Object.entries(provider.extraAuthorizeParams ?? {})) {
    url.searchParams.set(k, v);
  }

  return url.toString();
}

export async function exchangeCodeForToken(
  provider: ProviderDefinition,
  code: string,
  codeVerifier?: string,
): Promise<TokenSet> {
  const { id, secret } = clientCreds(provider);

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    // Instagram appends a `#_` fragment to the code on some redirects.
    code: code.replace(/#_$/, ''),
    redirect_uri: redirectUri(provider.platform),
  });

  if (provider.usesPkce) {
    if (!codeVerifier) throw new Error(`${provider.label} requires a PKCE verifier for the code exchange.`);
    body.set('code_verifier', codeVerifier);
  }

  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    'User-Agent': USER_AGENT,
  };

  if (provider.usesBasicAuth) {
    headers.Authorization = `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
  } else {
    body.set(provider.clientIdParam, id);
    body.set('client_secret', secret);
  }

  const res = await fetch(provider.tokenUrl, { method: 'POST', headers, body });
  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }

  const data = await res.json();

  // Instagram's newer response nests the grant inside `data[0]`.
  const grant = Array.isArray(data.data) && data.data.length ? data.data[0] : data;
  if (!grant.access_token) {
    throw new Error(`Token exchange returned no access token: ${JSON.stringify(data).slice(0, 200)}`);
  }

  const tokens: TokenSet = {
    accessToken: grant.access_token,
    refreshToken: grant.refresh_token,
    expiresAt: grant.expires_in ? new Date(Date.now() + Number(grant.expires_in) * 1000) : undefined,
    // `permissions` is Instagram's name for the granted scope list.
    scopes: parseScopes(grant.scope ?? grant.permissions, provider.scopes),
  };

  return provider.postExchange ? provider.postExchange(tokens) : tokens;
}

export async function refreshAccessToken(
  provider: ProviderDefinition,
  tokens: TokenSet,
): Promise<TokenSet> {
  if (provider.refresh) return provider.refresh(tokens);

  if (!tokens.refreshToken) {
    throw new Error(`No refresh token stored for ${provider.label}. Reconnect the account.`);
  }

  const { id, secret } = clientCreds(provider);
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken });
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    'User-Agent': USER_AGENT,
  };

  if (provider.usesBasicAuth) {
    headers.Authorization = `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
  } else {
    body.set(provider.clientIdParam, id);
    body.set('client_secret', secret);
  }

  const res = await fetch(provider.tokenUrl, { method: 'POST', headers, body });
  if (!res.ok) {
    throw new Error(`Token refresh failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    // Providers that rotate refresh tokens return a new one; others reuse it.
    refreshToken: data.refresh_token ?? tokens.refreshToken,
    expiresAt: data.expires_in ? new Date(Date.now() + Number(data.expires_in) * 1000) : undefined,
    scopes: parseScopes(data.scope, tokens.scopes),
  };
}

/**
 * Asks the provider to invalidate the token. Best-effort by design: a failure
 * here must not block the user from disconnecting locally, but we try first so
 * a disconnected account does not leave a live token behind.
 */
export async function revokeToken(provider: ProviderDefinition, tokens: TokenSet): Promise<void> {
  if (provider.revoke) return provider.revoke(tokens);
  if (!provider.revokeUrl) return;

  const { id, secret } = clientCreds(provider);
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    'User-Agent': USER_AGENT,
  };

  // Revoking the refresh token invalidates the whole grant where supported.
  const target = tokens.refreshToken ?? tokens.accessToken;
  const body = new URLSearchParams({ token: target });

  if (provider.usesBasicAuth) {
    headers.Authorization = `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
    body.set('token_type_hint', tokens.refreshToken ? 'refresh_token' : 'access_token');
  } else {
    body.set(provider.clientIdParam, id);
    body.set('client_secret', secret);
  }

  const res = await fetch(provider.revokeUrl, { method: 'POST', headers, body });
  if (!res.ok) {
    throw new Error(`Revocation failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
}

export interface CollectedMetrics {
  metrics: ProviderMetrics;
  /** Sources skipped because the user did not grant their scopes. */
  skipped: Array<{ id: string; label: string; missingScopes: string[] }>;
  /** Sources that were authorized but failed at the API. */
  failed: Array<{ id: string; label: string; message: string }>;
}

const ZERO_METRICS: ProviderMetrics = {
  followers: 0,
  following: 0,
  postsCount: 0,
  impressions: 0,
  engagements: 0,
  profileViews: 0,
  linkClicks: 0,
};

/**
 * Runs only the metric sources whose scopes the user actually granted.
 *
 * This is the enforcement point for least privilege: an ungranted source is
 * never called, so Traction cannot make a request the user did not authorize
 * even if the provider would have allowed it.
 */
export async function collectMetrics(
  provider: ProviderDefinition,
  accessToken: string,
  profile: ProviderProfile,
  grantedScopes: string[],
): Promise<CollectedMetrics> {
  const granted = new Set(grantedScopes);
  const metrics: ProviderMetrics = { ...ZERO_METRICS };
  const skipped: CollectedMetrics['skipped'] = [];
  const failed: CollectedMetrics['failed'] = [];

  for (const source of provider.metricSources) {
    const missingScopes = source.scopes.filter((scope) => !granted.has(scope));
    if (missingScopes.length) {
      skipped.push({ id: source.id, label: source.label, missingScopes });
      continue;
    }

    try {
      const partial = await source.fetch({ accessToken, profile });
      for (const [key, value] of Object.entries(partial)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
          metrics[key as keyof ProviderMetrics] = value;
        }
      }
    } catch (err) {
      failed.push({
        id: source.id,
        label: source.label,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { metrics, skipped, failed };
}

/** True when the granted set covers everything needed to identify the account. */
export function canReadProfile(provider: ProviderDefinition, grantedScopes: string[]): boolean {
  const granted = new Set(grantedScopes);
  return provider.profileScopes.every((scope) => granted.has(scope));
}
