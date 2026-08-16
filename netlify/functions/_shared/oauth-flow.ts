import { authenticate, serviceClient } from './supabase.js';
import { appUrl, error, json, readJson } from './http.js';
import {
  buildAuthorizeUrl,
  canReadProfile,
  exchangeCodeForToken,
  getProvider,
  isConfigured,
  type ProviderDefinition,
} from './providers.js';
import { createNonce, createPkcePair, encodeState, decodeState, serializeCookie, clearCookie, readCookie } from './oauth-state.js';
import { hasEncryptionKey } from './crypto.js';
import { saveTokens } from './tokens.js';
import type { Platform } from '../../../shared/types.js';

/**
 * The two halves of the authorization-code flow, shared by every platform.
 *
 * Each platform gets its own thin handler function so that platform-specific
 * quirks have somewhere to live, but the security-critical parts — session
 * binding, PKCE, signed state, the CSRF check, token storage — exist once so
 * they can be audited once.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Maps a thrown error to something safe to show a user.
 *
 * Provider responses can echo back request parameters, so a raw message could
 * carry a code or token. Everything is matched to a known shape and rewritten;
 * the detail goes to the server log instead.
 */
export function userFacingError(err: unknown, provider: ProviderDefinition): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (lower.includes('is not configured')) {
    return `${provider.label} is not set up on this deployment yet. The site owner needs to add its OAuth credentials.`;
  }
  if (lower.includes('token exchange failed')) {
    if (lower.includes('400') || lower.includes('invalid_grant')) {
      return 'That authorization link had already been used or had expired. Please try connecting again.';
    }
    if (lower.includes('401') || lower.includes('invalid_client')) {
      return `${provider.label} rejected this app's credentials. The site owner needs to check the configured client ID and secret.`;
    }
    return `${provider.label} would not complete the authorization. Please try again.`;
  }
  if (lower.includes('token refresh failed')) {
    return `Your ${provider.label} authorization has expired. Please reconnect the account.`;
  }
  if (lower.includes('fetch failed') || lower.includes('econnrefused') || lower.includes('etimedout')) {
    return `Could not reach ${provider.label}. This is usually temporary — please try again.`;
  }
  if (lower.includes('no youtube channel')) return raw;
  if (lower.includes('no account identifier') || lower.includes('no user record')) {
    return `${provider.label} did not return an account for this login. Make sure you are signing in with the right account type.`;
  }
  if (lower.includes('responded 401') || lower.includes('responded 403')) {
    return `${provider.label} refused the request with the permissions granted. Please reconnect and accept the requested permissions.`;
  }
  if (lower.includes('responded 429')) {
    return `${provider.label} is rate-limiting this app right now. Please try again in a few minutes.`;
  }

  return `Could not complete the ${provider.label} connection. Please try again.`;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

/**
 * POST — begins the flow for `platform`.
 *
 * The caller must be signed in: the authenticated Supabase user id is baked
 * into the signed state, which is what binds the eventual callback to the
 * right Traction account. There is no path where the browser supplies the user
 * id, so a connection cannot be attributed to someone else.
 */
export async function handleStart(platform: Platform, req: Request): Promise<Response> {
  if (req.method !== 'POST') return error('Method not allowed', 405);

  const auth = await authenticate(req);
  if (!auth) return error('Not signed in', 401);

  if (!hasEncryptionKey()) {
    return error(
      'This deployment has no token encryption key configured, so social accounts cannot be connected securely yet.',
      503,
    );
  }

  const provider = getProvider(platform);
  if (!isConfigured(provider)) {
    return error(
      `${provider.label} is not set up on this deployment. The site owner needs to add ${provider.clientIdEnv} and ${provider.clientSecretEnv}.`,
      503,
    );
  }

  const body = await readJson<{ returnTo?: string }>(req);
  // Only same-origin paths, so this can't be turned into an open redirect.
  const requested = body?.returnTo ?? '/account';
  const returnTo = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/account';

  const pkce = provider.usesPkce ? createPkcePair() : undefined;

  const state = encodeState({
    userId: auth.userId,
    platform,
    nonce: createNonce(),
    codeVerifier: pkce?.verifier,
    returnTo,
    issuedAt: Date.now(),
  });

  try {
    const url = buildAuthorizeUrl(provider, state, pkce?.challenge);
    return json({ url }, 200, { 'set-cookie': serializeCookie(state) });
  } catch (err) {
    console.error(`[oauth:${platform}:start]`, err);
    return error(userFacingError(err, provider), 500);
  }
}

// ---------------------------------------------------------------------------
// Callback
// ---------------------------------------------------------------------------

function redirectBack(to: string, params: Record<string, string>): Response {
  const target = to.startsWith('/') && !to.startsWith('//') ? `${appUrl()}${to}` : `${appUrl()}/account`;
  const url = new URL(target);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Response(null, {
    status: 302,
    headers: { location: url.toString(), 'set-cookie': clearCookie() },
  });
}

/**
 * GET — completes the flow for `platform`.
 *
 * Always redirects back into the app with a result flag rather than rendering
 * an error page, so every outcome surfaces as UI the user can act on.
 */
export async function handleCallback(platform: Platform, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const providerError = url.searchParams.get('error');

  const state = stateParam ? decodeState(stateParam) : null;
  const cookie = readCookie(req);
  const fallback = '/account';
  const provider = getProvider(platform);

  // 1. The user pressed "Cancel" on the consent screen.
  if (providerError) {
    const denied = ['access_denied', 'user_denied', 'user_cancelled_login', 'user_cancelled_authorize'].includes(
      providerError,
    );
    return redirectBack(state?.returnTo ?? fallback, {
      connect: 'error',
      platform,
      reason: denied
        ? `You cancelled the ${provider.label} authorization. Nothing was connected.`
        : `${provider.label} declined the authorization request. Please try again.`,
    });
  }

  // 2. Missing or unreadable state — expired, tampered, or a bare visit.
  if (!code || !state) {
    return redirectBack(fallback, {
      connect: 'error',
      platform,
      reason: 'That authorization link has expired or is invalid. Please start the connection again.',
    });
  }

  // 3. The state parameter must match the cookie exactly. This is the CSRF
  //    check: an attacker can put a code in the URL but cannot set our
  //    httpOnly cookie, so a forged callback dies here.
  if (cookie !== stateParam) {
    return redirectBack(state.returnTo, {
      connect: 'error',
      platform,
      reason: 'The authorization could not be verified as yours. Please start the connection again.',
    });
  }

  // 4. The state must belong to the platform whose handler this is, so a code
  //    issued for one provider cannot be replayed against another.
  if (state.platform !== platform) {
    return redirectBack(state.returnTo, {
      connect: 'error',
      platform,
      reason: 'That authorization was for a different platform. Please start the connection again.',
    });
  }

  const db = serviceClient();

  try {
    const tokens = await exchangeCodeForToken(provider, code, state.codeVerifier);

    // 5. If the user unticked permissions we cannot even identify the account.
    if (!canReadProfile(provider, tokens.scopes)) {
      const missing = provider.profileScopes.filter((s) => !tokens.scopes.includes(s));
      return redirectBack(state.returnTo, {
        connect: 'error',
        platform,
        reason: `Traction needs the ${missing.join(', ')} permission to read your ${provider.label} account. Please reconnect and accept it.`,
      });
    }

    const profile = await provider.fetchProfile(tokens.accessToken);

    // Reconnecting the same account updates the existing row; a different
    // account on the same platform becomes an additional connection.
    const { data: account, error: accountError } = await db
      .from('social_accounts')
      .upsert(
        {
          user_id: state.userId,
          platform,
          external_id: profile.externalId,
          handle: profile.handle,
          display_name: profile.displayName ?? null,
          avatar_url: profile.avatarUrl ?? null,
          profile_url: profile.profileUrl ?? null,
          scopes: tokens.scopes,
          status: 'connected',
          status_detail: null,
          needs_reauth_since: null,
          last_authorized_at: new Date().toISOString(),
          last_sync_status: 'pending',
          last_sync_error: null,
        },
        { onConflict: 'user_id,platform,external_id' },
      )
      .select('id')
      .single();

    if (accountError) throw new Error(accountError.message);

    await saveTokens(db, account.id, tokens);

    await db.from('social_account_metadata').upsert({
      account_id: account.id,
      user_id: state.userId,
      platform,
      data: {
        handle: profile.handle,
        display_name: profile.displayName ?? null,
        profile_url: profile.profileUrl ?? null,
        granted_scopes: tokens.scopes,
      },
      captured_at: new Date().toISOString(),
    });

    const declined = provider.scopes.filter((s) => !tokens.scopes.includes(s));
    return redirectBack(state.returnTo, {
      connect: 'success',
      platform,
      handle: profile.handle,
      ...(declined.length ? { partial: declined.join(',') } : {}),
    });
  } catch (err) {
    // The detail stays in the server log; the user gets a safe summary.
    console.error(`[oauth:${platform}:callback]`, err);
    return redirectBack(state.returnTo, {
      connect: 'error',
      platform,
      reason: userFacingError(err, provider),
    });
  }
}
