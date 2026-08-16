import { withErrorHandling } from './_shared/http.js';
import { handleStart } from './_shared/oauth-flow.js';

/**
 * POST /api/oauth/x/start
 *
 * Begins the X authorization-code flow. Platform-specific handling for
 * X belongs here; everything shared lives in _shared/oauth-flow.ts.
 */
export default withErrorHandling((req: Request) => handleStart('x', req));
