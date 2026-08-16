import { serviceClient } from './_shared/supabase.js';
import { appUrl, withErrorHandling } from './_shared/http.js';
import { canReadProfile, exchangeCodeForToken, getProvider } from './_shared/providers.js';
import { clearCookie, decodeState, readCookie } from './_shared/oauth-state.js';
import { saveTokens } from './_shared/tokens.js';

/**
 * GET /.netlify/functions/oauth-callback?platform=…&code=…&state=…
 *
 * The provider redirects the browser here. We verify the signed state against
 * the cookie set at start, exchange the code, and persist the account. The
 * response is always a redirect back into the app carrying a result flag, so
 * failures surface as UI rather than a bare error page.
 */

function redirectBack(to: string, params: Record<string, string>): Response {
  const url = new URL(to.startsWith('http') ? to : `${appUrl()}${to}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Response(null, {
    status: 302,
    headers: { location: url.toString(), 'set-cookie': clearCookie() },
  });
}

export default withErrorHandling(async (req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const providerError = url.searchParams.get('error');

  const cookie = readCookie(req);
  const state = stateParam ? decodeState(stateParam) : null;
  const fallback = '/accounts';

  if (providerError) {
    return redirectBack(state?.returnTo ?? fallback, {
      connect: 'error',
      reason: url.searchParams.get('error_description') ?? providerError,
    });
  }

  if (!code || !state) {
    return redirectBack(fallback, { connect: 'error', reason: 'Missing or expired authorization state.' });
  }

  // The cookie must match the state parameter exactly — this is the CSRF check.
  if (cookie !== stateParam) {
    return redirectBack(state.returnTo, {
      connect: 'error',
      reason: 'Authorization state did not match. Please try connecting again.',
    });
  }

  const provider = getProvider(state.platform);
  const db = serviceClient();

  try {
    const tokens = await exchangeCodeForToken(provider, code, state.codeVerifier);

    // The user may have unticked permissions on the consent screen. If what
    // they granted cannot even identify the account, stop here rather than
    // storing a token we can do nothing useful with.
    if (!canReadProfile(provider, tokens.scopes)) {
      const missing = provider.profileScopes.filter((s) => !tokens.scopes.includes(s));
      return redirectBack(state.returnTo, {
        connect: 'error',
        reason: `Traction needs the ${missing.join(', ')} permission to read your ${provider.label} account. Please reconnect and accept it.`,
      });
    }

    const profile = await provider.fetchProfile(tokens.accessToken);

    const { data: account, error: accountError } = await db
      .from('social_accounts')
      .upsert(
        {
          user_id: state.userId,
          platform: state.platform,
          external_id: profile.externalId,
          handle: profile.handle,
          display_name: profile.displayName ?? null,
          avatar_url: profile.avatarUrl ?? null,
          profile_url: profile.profileUrl ?? null,
          scopes: tokens.scopes,
          is_active: true,
          last_sync_status: 'pending',
          last_sync_error: null,
        },
        { onConflict: 'user_id,platform,external_id' },
      )
      .select('id')
      .single();

    if (accountError) throw new Error(accountError.message);

    await saveTokens(db, account.id, tokens);

    // Tell the user when they granted less than we asked for, so a thin
    // dashboard later has an explanation attached to it now.
    const declined = provider.scopes.filter((s) => !tokens.scopes.includes(s));
    return redirectBack(state.returnTo, {
      connect: 'success',
      platform: state.platform,
      ...(declined.length ? { partial: declined.join(',') } : {}),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error('[oauth-callback]', err);
    return redirectBack(state.returnTo, { connect: 'error', reason: reason.slice(0, 200) });
  }
});
