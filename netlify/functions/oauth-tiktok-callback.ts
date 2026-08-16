import { withErrorHandling } from './_shared/http.js';
import { handleCallback } from './_shared/oauth-flow.js';

/**
 * GET /api/oauth/tiktok/callback
 *
 * Completes the TikTok authorization-code flow. Register exactly this URL as
 * the redirect URI in the TikTok developer console.
 */
export default withErrorHandling((req: Request) => handleCallback('tiktok', req));
