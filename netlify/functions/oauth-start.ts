import { error, readJson, withErrorHandling } from './_shared/http.js';
import { handleStart } from './_shared/oauth-flow.js';
import { DEDICATED_ROUTE_PLATFORMS } from './_shared/providers.js';
import { PLATFORMS, type Platform } from '../../shared/types.js';

/**
 * POST /.netlify/functions/oauth-start
 * Body: { platform, returnTo? }
 *
 * Generic entry point for the platforms that do not have a dedicated handler
 * (LinkedIn, Reddit, YouTube, Instagram). X, TikTok, and Pinterest are served
 * by their own functions at /api/oauth/<platform>/start; this rejects them so
 * there is exactly one path per platform and no ambiguity about which redirect
 * URI was used.
 */
export default withErrorHandling(async (req: Request) => {
  const body = await readJson<{ platform?: string; returnTo?: string }>(req);
  const platform = body?.platform;

  if (!platform) return error('A platform is required.', 400);
  if (!PLATFORMS.includes(platform as Platform)) {
    return error(`Unsupported platform: ${platform}`, 400);
  }
  if (DEDICATED_ROUTE_PLATFORMS.has(platform as Platform)) {
    return error(`Use /api/oauth/${platform}/start for ${platform}.`, 400);
  }

  // handleStart re-reads the body, so hand it a request with an intact stream.
  return handleStart(
    platform as Platform,
    new Request(req.url, {
      method: req.method,
      headers: req.headers,
      body: JSON.stringify({ returnTo: body?.returnTo }),
    }),
  );
});
