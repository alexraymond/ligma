/**
 * The daemon HTTP client — every command routes its requests through here so
 * "not reachable" and "API returned an error" are handled exactly once.
 */
import { DEFAULT_DAEMON_PORT } from '@ligma/api';

/** An expected, user-facing failure: printed plainly by the CLI, no stack trace. */
export class CliError extends Error {}

export function resolveBaseUrl(portFlag?: string): string {
  const port = portFlag ?? process.env.LIGMA_DAEMON_PORT ?? String(DEFAULT_DAEMON_PORT);
  return `http://127.0.0.1:${port}`;
}

// ponytail: Node's fetch collapses connection-refused, DNS failure, etc. into
// a bare `TypeError: fetch failed` with no inspectable `cause.code` in this
// runtime — so "fetch failed" is treated as "daemon not reachable" wholesale.
// A single-user localhost tool has no other client on that port to confuse it with.
function isUnreachable(err: unknown): boolean {
  return (
    err instanceof TypeError &&
    (err.message === 'fetch failed' || err.message.includes('ECONNREFUSED'))
  );
}

async function daemonFetch(baseUrl: string, path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${baseUrl}${path}`, init);
  } catch (err) {
    if (isUnreachable(err)) {
      throw new CliError(
        `daemon not reachable at ${baseUrl} — is it running? (pnpm --filter @ligma/daemon daemon:start)`,
      );
    }
    throw err;
  }
}

/** D7: a wedged-but-connected daemon must not hang a command forever — bound
 * every request to this timeout, on top of whatever caller signal (e.g. SIGINT)
 * is already threaded through. */
const REQUEST_TIMEOUT_MS = 15_000;

function withTimeout(signal?: AbortSignal | null): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** GET/POST/PATCH JSON helper. Throws CliError with the server's `error` message on non-2xx. */
export async function daemonJson<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const res = await daemonFetch(baseUrl, path, { ...init, signal: withTimeout(init?.signal) });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `Request failed (${res.status})`;
    throw new CliError(message);
  }
  return body as T;
}

/** Raw response for the SSE/streaming endpoints, which don't want JSON parsing. */
export async function daemonRaw(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return daemonFetch(baseUrl, path, init);
}
