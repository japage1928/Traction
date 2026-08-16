import { withErrorHandling } from './_shared/http.js';
import { handleCallback } from './_shared/oauth-flow.js';

/**
 * GET /api/oauth/x/callback
 *
 * Completes the X authorization-code flow. Register exactly this URL as
 * the redirect URI in the X developer console.
 */
export default withErrorHandling((req: Request) => handleCallback('x', req));
