import { authenticate, serviceClient } from './_shared/supabase.js';
import { error, json, readJson, withErrorHandling } from './_shared/http.js';
import { getProvider, revokeToken } from './_shared/providers.js';
import { loadTokens } from './_shared/tokens.js';

/**
 * POST /.netlify/functions/disconnect
 * Body: { accountId }
 *
 * Revokes the grant at the provider, then deletes the local account row —
 * which cascades to the stored tokens.
 *
 * The order matters. Deleting our row first would leave a live token sitting
 * at the provider with nothing left to revoke it with, so the user would think
 * they had disconnected while the authorization was still standing. Revocation
 * is still best-effort: if the provider rejects the call we say so, delete
 * locally anyway, and point the user at their platform settings, because
 * refusing to disconnect would be worse than a stale grant they can clear.
 */
export default withErrorHandling(async (req: Request) => {
  if (req.method !== 'POST') return error('Method not allowed', 405);

  const auth = await authenticate(req);
  if (!auth) return error('Not signed in', 401);

  const body = await readJson<{ accountId?: string }>(req);
  if (!body?.accountId) return error('An accountId is required.', 400);

  const db = serviceClient();

  // Scope the lookup to the caller so one user cannot disconnect another's
  // account by guessing an id.
  const { data: account, error: lookupError } = await db
    .from('social_accounts')
    .select('id, platform, handle, scopes')
    .eq('id', body.accountId)
    .eq('user_id', auth.userId)
    .maybeSingle();

  if (lookupError) throw new Error(lookupError.message);
  if (!account) return error('Account not found.', 404);

  let revoked = false;
  let revocationNote: string | null = null;

  try {
    const provider = getProvider(account.platform);
    const tokens = await loadTokens(db, account.id, account.scopes ?? []);

    if (!tokens) {
      revocationNote = 'No stored token was found, so there was nothing to revoke.';
    } else if (!provider.revokeUrl && !provider.revoke) {
      revocationNote = `${provider.label} does not offer a revocation endpoint. Remove Traction from your ${provider.label} app settings to fully withdraw access.`;
    } else {
      await revokeToken(provider, tokens);
      revoked = true;
    }
  } catch (err) {
    revocationNote =
      `Could not revoke the token at the provider: ${err instanceof Error ? err.message : String(err)}. ` +
      'The account has been disconnected here — remove Traction in your platform settings to be certain.';
    console.error('[disconnect] revocation failed', err);
  }

  const { error: deleteError } = await db
    .from('social_accounts')
    .delete()
    .eq('id', account.id)
    .eq('user_id', auth.userId);

  if (deleteError) throw new Error(deleteError.message);

  return json({ disconnected: true, revoked, note: revocationNote });
});
