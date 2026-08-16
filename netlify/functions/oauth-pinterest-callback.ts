import { withErrorHandling } from './_shared/http.js';
import { handleCallback } from './_shared/oauth-flow.js';

/**
 * GET /api/oauth/pinterest/callback
 *
 * Completes the Pinterest authorization-code flow. Register exactly this URL as
 * the redirect URI in the Pinterest developer console.
 */
export default withErrorHandling((req: Request) => handleCallback('pinterest', req));
