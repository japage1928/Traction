import { json, withErrorHandling } from './_shared/http.js';
import { PROVIDERS, isConfigured } from './_shared/providers.js';
import { hasEncryptionKey } from './_shared/crypto.js';

/**
 * GET /.netlify/functions/providers-status
 *
 * Tells the Accounts page which integrations this deployment can actually
 * offer, and what each one will ask the user to authorize, so consent is
 * informed before the redirect rather than a surprise on the provider's page.
 */
export default withErrorHandling(async () => {
  const providers = Object.values(PROVIDERS).map((p) => ({
    platform: p.platform,
    label: p.label,
    configured: isConfigured(p),
    scopes: p.scopes,
    permissionSummary: p.permissionSummary,
    usesPkce: p.usesPkce,
    canRevoke: Boolean(p.revokeUrl || p.revoke),
    missingEnv: isConfigured(p) ? [] : [p.clientIdEnv, p.clientSecretEnv],
  }));

  return json({
    providers,
    encryptionReady: hasEncryptionKey(),
    aiReady: Boolean(process.env.ANTHROPIC_API_KEY),
  });
});
