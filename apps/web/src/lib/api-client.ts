/**
 * Authenticated API client for Mission Control.
 *
 * Wraps fetch() with:
 * - Automatic Bearer token injection (NEXT_PUBLIC_MC_API_TOKEN)
 * - Retry with exponential backoff for network errors and 5xx responses
 * - Configurable retry behavior per request
 */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Extended RequestInit with retry options. */
export interface ApiFetchInit extends RequestInit {
  /** Max retries on network error or 5xx (default: 2 for GET, 0 for mutations). */
  retries?: number;
  /** Base delay in ms before first retry (doubles each attempt, default: 500). */
  retryDelay?: number;
}

/**
 * Fetch wrapper with auth + automatic retry for transient failures.
 *
 * - GET requests retry up to 2 times by default (safe to retry reads).
 * - POST/PUT/DELETE default to 0 retries (mutations need explicit opt-in).
 * - Retries only on network errors and 5xx responses (never on 4xx).
 */
export async function apiFetch(url: string, init?: ApiFetchInit): Promise<Response> {
  const token = process.env.NEXT_PUBLIC_MC_API_TOKEN;
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const method = (init?.method ?? 'GET').toUpperCase();
  // The daemon 415s any POST/PUT/PATCH with no `content-type: application/json`
  // (P20 hardening — a form post can't send that header, so it can't fire a
  // mutating request cross-origin). Every mutating call in this app *is* JSON
  // (or has no body at all, which this header does not change), so it is set
  // here once rather than at every call site — including the bodiless action
  // triggers ("start", "approve", …) that used to send no header at all.
  if (['POST', 'PUT', 'PATCH'].includes(method) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const isMutation = method !== 'GET' && method !== 'HEAD';
  const maxRetries = init?.retries ?? (isMutation ? 0 : 2);
  const baseDelay = init?.retryDelay ?? 500;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers });

      // Only retry on 5xx (server error), never on 4xx (client error)
      if (res.status >= 500 && attempt < maxRetries) {
        await sleep(baseDelay * 2 ** attempt);
        continue;
      }

      return res;
    } catch (err) {
      // Network error (server unreachable, DNS failure, CORS, etc.)
      lastError = err;
      if (attempt < maxRetries) {
        await sleep(baseDelay * 2 ** attempt);
      }
    }
  }

  // All retries exhausted — throw the last error
  throw lastError;
}
