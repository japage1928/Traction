import { appUrl, withErrorHandling } from './_shared/http.js';
import { handleCallback } from './_shared/oauth-flow.js';
import { PLATFORMS, type Platform } from '../../shared/types.js';

/**
 * GET /.netlify/functions/oauth-callback?platform=…
 *
 * Generic callback for the platforms without a dedicated handler (LinkedIn,
 * Reddit, YouTube, Instagram). X, TikTok, and Pinterest use their own
 * functions at /api/oauth/<platform>/callback.
 */
export default withErrorHandling(async (req: Request) => {
  const platform = new URL(req.url).searchParams.get('platform');

  if (!platform || !PLATFORMS.includes(platform as Platform)) {
    // No usable state to read a returnTo from, so send them somewhere sensible.
    const url = new URL(`${appUrl()}/account`);
    url.searchParams.set('connect', 'error');
    url.searchParams.set('reason', 'That authorization link was missing a valid platform. Please start again.');
    return new Response(null, { status: 302, headers: { location: url.toString() } });
  }

  return handleCallback(platform as Platform, req);
});
