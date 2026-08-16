import { withErrorHandling } from './_shared/http.js';
import { handleStart } from './_shared/oauth-flow.js';

/**
 * POST /api/oauth/tiktok/start
 *
 * Begins the TikTok authorization-code flow. Platform-specific handling for
 * TikTok belongs here; everything shared lives in _shared/oauth-flow.ts.
 */
export default withErrorHandling((req: Request) => handleStart('tiktok', req));
