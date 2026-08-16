import { json, withErrorHandling } from './_shared/http.js';
import { PROVIDERS, isConfigured } from './_shared/providers.js';
import { hasEncryptionKey } from './_shared/crypto.js';

/**
 * GET /.netlify/functions/providers-status
 *
 * Tells the Accounts page which integrations this deployment can actually
 * offer, so it can explain what is missing instead of failing on click.
 */
export default withErrorHandling(async () => {
  const providers = Object.values(PROVIDERS)
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({
      platform: p.platform,
      label: p.label,
      configured: isConfigured(p),
      scopes: p.scopes,
      missingEnv: isConfigured(p) ? [] : [p.clientIdEnv, p.clientSecretEnv],
    }));

  return json({
    providers,
    encryptionReady: hasEncryptionKey(),
    aiReady: Boolean(process.env.ANTHROPIC_API_KEY),
  });
});
