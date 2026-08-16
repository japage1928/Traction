import { authenticate, serviceClient } from './_shared/supabase.js';
import { error, json, readJson, withErrorHandling } from './_shared/http.js';
import { getProvider, revokeToken } from './_shared/providers.js';
import { loadTokens } from './_shared/tokens.js';
import { userFacingError } from './_shared/oauth-flow.js';

/**
 * POST /.netlify/functions/disconnect
 * Body: { accountId }
 *
 * Order of operations matters, and each step is deliberate:
 *
 *  1. Revoke at the provider FIRST. Deleting our copy first would strand a
 *     live token with nothing left to revoke it with, so the user would
 *     believe they had disconnected while the grant still stood.
 *  2. Hard-delete the stored tokens. Nothing usable is left behind.
 *  3. Mark the connection `disconnected` rather than deleting the row —
 *     `account_metrics` cascades from it, so deleting would silently destroy
 *     the user's entire analytics history. Reconnecting the same account
 *     revives the row and the history with it.
 *
 * Revocation is best-effort: if the provider refuses we say so plainly and
 * still complete steps 2 and 3, because refusing to disconnect would leave the
 * user worse off than a stale grant they can clear in platform settings.
 */
export default withErrorHandling(async (req: Request) => {
  if (req.method !== 'POST') return error('Method not allowed', 405);

  const auth = await authenticate(req);
  if (!auth) return error('Not signed in', 401);

  const body = await readJson<{ accountId?: string }>(req);
  if (!body?.accountId) return error('An accountId is required.', 400);

  const db = serviceClient();

  // Scoped to the caller, so a guessed or manipulated id resolves to nothing
  // rather than to somebody else's connection.
  const { data: account, error: lookupError } = await db
    .from('social_accounts')
    .select('id, platform, handle, scopes, status')
    .eq('id', body.accountId)
    .eq('user_id', auth.userId)
    .maybeSingle();

  if (lookupError) throw new Error(lookupError.message);
  if (!account) return error('Account not found.', 404);

  const provider = getProvider(account.platform);
  let revoked = false;
  let note: string | null = null;

  // --- 1. Revoke at the provider -------------------------------------------
  try {
    const tokens = await loadTokens(db, account.id, account.scopes ?? []);

    if (!tokens) {
      note = 'No stored credentials were found, so there was nothing to revoke.';
    } else if (!provider.revokeUrl && !provider.revoke) {
      note =
        `${provider.label} does not publish a token revocation endpoint. Traction has deleted its copy of your ` +
        `credentials — to fully withdraw access, also remove Traction in your ${provider.label} account settings.`;
    } else {
      await revokeToken(provider, tokens);
      revoked = true;
    }
  } catch (err) {
    console.error('[disconnect] revocation failed', err);
    note =
      `${userFacingError(err, provider)} Traction has deleted its copy of your credentials, but you should also ` +
      `remove Traction in your ${provider.label} account settings to be certain.`;
  }

  // --- 2. Destroy the stored credentials -----------------------------------
  const { error: tokenDeleteError } = await db
    .from('social_account_tokens')
    .delete()
    .eq('account_id', account.id);

  if (tokenDeleteError) throw new Error(tokenDeleteError.message);

  // --- 3. Retire the connection, keeping analytics history ------------------
  const { error: updateError } = await db
    .from('social_accounts')
    .update({
      status: 'disconnected',
      status_detail: revoked
        ? `Disconnected. ${provider.label} revoked Traction's access.`
        : 'Disconnected. Stored credentials were deleted.',
      needs_reauth_since: null,
      last_sync_error: null,
    })
    .eq('id', account.id)
    .eq('user_id', auth.userId);

  if (updateError) throw new Error(updateError.message);

  return json({
    disconnected: true,
    revoked,
    note,
    // Metrics collected while connected survive; only credentials are gone.
    historyPreserved: true,
  });
});
