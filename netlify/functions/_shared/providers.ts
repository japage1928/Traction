import type { Platform } from '../../../shared/types.js';
import { appUrl } from './http.js';

/**
 * Provider registry.
 *
 * Each entry describes one platform's OAuth 2.0 dance plus the calls needed to
 * identify the account and read its metrics. Providers with no credentials in
 * the environment report `configured: false` and are surfaced in the UI as
 * unavailable rather than failing at connect time.
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
  scopes: string[];
}

export interface ProviderDefinition {
  platform: Platform;
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** X and Google require PKCE; Reddit and LinkedIn do not. */
  usesPkce: boolean;
  /** Reddit expects HTTP Basic auth on the token endpoint. */
  usesBasicAuth: boolean;
  clientIdEnv: string;
  clientSecretEnv: string;
  /** Extra params some providers require on the authorize URL. */
  extraAuthorizeParams?: Record<string, string>;
  fetchProfile: (accessToken: string) => Promise<ProviderProfile>;
  fetchMetrics: (accessToken: string, profile: ProviderProfile) => Promise<ProviderMetrics>;
}

const emptyMetrics: ProviderMetrics = {
  followers: 0,
  following: 0,
  postsCount: 0,
  impressions: 0,
  engagements: 0,
  profileViews: 0,
  linkClicks: 0,
};

async function getJson(url: string, accessToken: string, extraHeaders: Record<string, string> = {}) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'Traction/0.1 (marketing analytics)',
      ...extraHeaders,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${new URL(url).host} responded ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// X (Twitter)
// ---------------------------------------------------------------------------

const x: ProviderDefinition = {
  platform: 'x',
  label: 'X',
  authorizeUrl: 'https://twitter.com/i/oauth2/authorize',
  tokenUrl: 'https://api.twitter.com/2/oauth2/token',
  scopes: ['tweet.read', 'users.read', 'offline.access'],
  usesPkce: true,
  usesBasicAuth: true,
  clientIdEnv: 'X_CLIENT_ID',
  clientSecretEnv: 'X_CLIENT_SECRET',
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
  async fetchMetrics(accessToken) {
    const data = await getJson(
      'https://api.x.com/2/users/me?user.fields=public_metrics',
      accessToken,
    );
    const m = data.data?.public_metrics ?? {};
    return {
      ...emptyMetrics,
      followers: m.followers_count ?? 0,
      following: m.following_count ?? 0,
      postsCount: m.tweet_count ?? 0,
    };
  },
};

// ---------------------------------------------------------------------------
// Reddit
// ---------------------------------------------------------------------------

const reddit: ProviderDefinition = {
  platform: 'reddit',
  label: 'Reddit',
  authorizeUrl: 'https://www.reddit.com/api/v1/authorize',
  tokenUrl: 'https://www.reddit.com/api/v1/access_token',
  scopes: ['identity', 'history', 'read'],
  usesPkce: false,
  usesBasicAuth: true,
  clientIdEnv: 'REDDIT_CLIENT_ID',
  clientSecretEnv: 'REDDIT_CLIENT_SECRET',
  extraAuthorizeParams: { duration: 'permanent' },
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
  async fetchMetrics(accessToken) {
    const u = await getJson('https://oauth.reddit.com/api/v1/me', accessToken);
    return {
      ...emptyMetrics,
      followers: u.subreddit?.subscribers ?? 0,
      // Reddit has no impression metric; karma is the closest engagement proxy.
      engagements: (u.link_karma ?? 0) + (u.comment_karma ?? 0),
    };
  },
};

// ---------------------------------------------------------------------------
// YouTube (Google)
// ---------------------------------------------------------------------------

const youtube: ProviderDefinition = {
  platform: 'youtube',
  label: 'YouTube',
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  scopes: ['https://www.googleapis.com/auth/youtube.readonly'],
  usesPkce: true,
  usesBasicAuth: false,
  clientIdEnv: 'YOUTUBE_CLIENT_ID',
  clientSecretEnv: 'YOUTUBE_CLIENT_SECRET',
  // Google only returns a refresh token when both are set.
  extraAuthorizeParams: { access_type: 'offline', prompt: 'consent' },
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
  async fetchMetrics(accessToken) {
    const data = await getJson(
      'https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true',
      accessToken,
    );
    const s = data.items?.[0]?.statistics ?? {};
    return {
      ...emptyMetrics,
      followers: Number(s.subscriberCount ?? 0),
      postsCount: Number(s.videoCount ?? 0),
      impressions: Number(s.viewCount ?? 0),
    };
  },
};

// ---------------------------------------------------------------------------
// LinkedIn
//
// Note: member-level analytics (impressions, engagement) require the Community
// Management API, which LinkedIn grants only to approved partners. With the
// default `openid profile` scopes we can identify the account but not read
// follower or impression counts, so metrics come back as zeros until the app
// is approved for the wider scopes.
// ---------------------------------------------------------------------------

const linkedin: ProviderDefinition = {
  platform: 'linkedin',
  label: 'LinkedIn',
  authorizeUrl: 'https://www.linkedin.com/oauth/v2/authorization',
  tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
  scopes: ['openid', 'profile', 'email'],
  usesPkce: false,
  usesBasicAuth: false,
  clientIdEnv: 'LINKEDIN_CLIENT_ID',
  clientSecretEnv: 'LINKEDIN_CLIENT_SECRET',
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
  async fetchMetrics() {
    // Requires Community Management API approval; see the note above.
    return { ...emptyMetrics };
  },
};

// ---------------------------------------------------------------------------

export const PROVIDERS: Partial<Record<Platform, ProviderDefinition>> = {
  x,
  reddit,
  youtube,
  linkedin,
};

export function getProvider(platform: string): ProviderDefinition {
  const provider = PROVIDERS[platform as Platform];
  if (!provider) throw new Error(`Unsupported platform: ${platform}`);
  return provider;
}

export function isConfigured(provider: ProviderDefinition): boolean {
  return Boolean(process.env[provider.clientIdEnv] && process.env[provider.clientSecretEnv]);
}

export function redirectUri(platform: Platform): string {
  return `${appUrl()}/.netlify/functions/oauth-callback?platform=${platform}`;
}

export function buildAuthorizeUrl(
  provider: ProviderDefinition,
  state: string,
  codeChallenge?: string,
): string {
  const url = new URL(provider.authorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', process.env[provider.clientIdEnv]!);
  url.searchParams.set('redirect_uri', redirectUri(provider.platform));
  url.searchParams.set('scope', provider.scopes.join(' '));
  url.searchParams.set('state', state);
  if (provider.usesPkce && codeChallenge) {
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
  const clientId = process.env[provider.clientIdEnv]!;
  const clientSecret = process.env[provider.clientSecretEnv]!;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(provider.platform),
  });
  if (provider.usesPkce && codeVerifier) body.set('code_verifier', codeVerifier);

  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    'User-Agent': 'Traction/0.1 (marketing analytics)',
  };

  if (provider.usesBasicAuth) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  } else {
    body.set('client_id', clientId);
    body.set('client_secret', clientSecret);
  }

  const res = await fetch(provider.tokenUrl, { method: 'POST', headers, body });
  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
    scopes: typeof data.scope === 'string' ? data.scope.split(/[\s,]+/) : provider.scopes,
  };
}

export async function refreshAccessToken(
  provider: ProviderDefinition,
  refreshToken: string,
): Promise<TokenSet> {
  const clientId = process.env[provider.clientIdEnv]!;
  const clientSecret = process.env[provider.clientSecretEnv]!;

  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    'User-Agent': 'Traction/0.1 (marketing analytics)',
  };

  if (provider.usesBasicAuth) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  } else {
    body.set('client_id', clientId);
    body.set('client_secret', clientSecret);
  }

  const res = await fetch(provider.tokenUrl, { method: 'POST', headers, body });
  if (!res.ok) {
    throw new Error(`Token refresh failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    // Providers that rotate refresh tokens return a new one; others reuse it.
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
    scopes: typeof data.scope === 'string' ? data.scope.split(/[\s,]+/) : provider.scopes,
  };
}
