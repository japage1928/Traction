/** Small helpers so every function returns consistently shaped responses. */

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

export function error(message: string, status = 400, extra?: Record<string, unknown>): Response {
  return json({ error: message, ...extra }, status);
}

/**
 * Wraps a handler so an unexpected throw becomes a 500 with a logged stack
 * rather than an opaque Netlify platform error.
 */
export function withErrorHandling(
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    try {
      return await handler(req);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[function error]', err);
      return error(message, 500);
    }
  };
}

/** Reads and parses a JSON body, returning null when the body is absent or invalid. */
export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export function appUrl(): string {
  return (process.env.APP_URL ?? 'http://localhost:8888').replace(/\/$/, '');
}
