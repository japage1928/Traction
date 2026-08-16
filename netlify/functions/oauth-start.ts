import { authenticate } from './_shared/supabase.js';
import { error, json, withErrorHandling, readJson } from './_shared/http.js';
import { buildAuthorizeUrl, getProvider, isConfigured } from './_shared/providers.js';
import { createNonce, createPkcePair, encodeState, serializeCookie } from './_shared/oauth-state.js';
import { hasEncryptionKey } from './_shared/crypto.js';
import type { Platform } from '../../shared/types.js';

/**
 * POST /.netlify/functions/oauth-start
 * Body: { platform, returnTo? }
 *
 * Returns the provider's authorize URL and parks the PKCE verifier in a signed
 * cookie. The browser then navigates to `url`.
 */
export default withErrorHandling(async (req: Request) => {
  if (req.method !== 'POST') return error('Method not allowed', 405);

  const auth = await authenticate(req);
  if (!auth) return error('Not signed in', 401);

  if (!hasEncryptionKey()) {
    return error(
      'TOKEN_ENCRYPTION_KEY is not configured, so account tokens cannot be stored securely. ' +
        'Set it before connecting accounts.',
      503,
    );
  }

  const body = await readJson<{ platform?: string; returnTo?: string }>(req);
  if (!body?.platform) return error('A platform is required.', 400);

  const provider = getProvider(body.platform);
  if (!isConfigured(provider)) {
    return error(
      `${provider.label} is not configured on this deployment. Set ${provider.clientIdEnv} and ${provider.clientSecretEnv}.`,
      503,
    );
  }

  const nonce = createNonce();
  const pkce = provider.usesPkce ? createPkcePair() : undefined;

  const state = encodeState({
    userId: auth.userId,
    platform: provider.platform as Platform,
    nonce,
    codeVerifier: pkce?.verifier,
    returnTo: body.returnTo ?? '/accounts',
    issuedAt: Date.now(),
  });

  const url = buildAuthorizeUrl(provider, state, pkce?.challenge);

  return json({ url }, 200, { 'set-cookie': serializeCookie(state) });
});
