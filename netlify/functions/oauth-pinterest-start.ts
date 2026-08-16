import { withErrorHandling } from './_shared/http.js';
import { handleStart } from './_shared/oauth-flow.js';

/**
 * POST /api/oauth/pinterest/start
 *
 * Begins the Pinterest authorization-code flow. Platform-specific handling for
 * Pinterest belongs here; everything shared lives in _shared/oauth-flow.ts.
 */
export default withErrorHandling((req: Request) => handleStart('pinterest', req));
