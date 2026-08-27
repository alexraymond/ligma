/**
 * The seam between Express and the moved Next.js route handlers.
 *
 * A handler still receives a web `Request` and returns a web `Response`; this
 * turns an Express request into the former and writes the latter back. That is
 * the whole reason the handlers could move without their bodies changing.
 */
import type { Request as ExRequest, Response as ExResponse, RequestHandler } from 'express';
import { DaemonRequest, type RouteHandler, type RouteModule } from '../http';

const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type Method = (typeof METHODS)[number];

/**
 * Methods that must declare `content-type: application/json` (process audit
 * P20, pinned decision 6).
 *
 * The API binds 127.0.0.1 and carries no auth token, so a page in the user's
 * browser could fire a no-cors POST at it — the response is unreadable
 * cross-origin, but the side effect (a workspace wipe, a promote, a task run)
 * does not need reading. A cross-origin request can only carry
 * `application/x-www-form-urlencoded`, `multipart/form-data` or `text/plain`
 * without provoking a CORS preflight the daemon never answers; demanding JSON
 * is therefore the whole gate, and it costs a legitimate client one header.
 *
 * DELETE is deliberately absent: no HTML form and no no-cors `fetch` can issue
 * one, so requiring a header there would break the query-param DELETEs this API
 * is full of and buy nothing.
 */
const JSON_REQUIRED: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH']);

function isJsonContentType(value: string | undefined): boolean {
  if (!value) return false;
  const mediaType = value.split(';')[0]?.trim().toLowerCase();
  return mediaType === 'application/json' || mediaType.endsWith('+json');
}

function absoluteUrl(req: ExRequest): string {
  const host = req.headers.host ?? '127.0.0.1';
  return `http://${host}${req.originalUrl}`;
}

function toWebRequest(req: ExRequest): DaemonRequest {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const one of Array.isArray(value) ? value : [value]) headers.append(key, one);
  }
  // express.text() leaves "" for bodiless requests; GET/HEAD may not carry a body.
  const raw: unknown = req.body;
  const body = typeof raw === 'string' && raw.length > 0 ? raw : undefined;
  const hasBody = body !== undefined && req.method !== 'GET' && req.method !== 'HEAD';
  return new DaemonRequest(absoluteUrl(req), {
    method: req.method,
    headers,
    ...(hasBody ? { body } : {}),
  });
}

async function send(res: ExResponse, webResponse: Response): Promise<void> {
  res.status(webResponse.status);
  webResponse.headers.forEach((value, key) => {
    // Node writes its own framing headers; copying them corrupts the response.
    if (key === 'content-length' || key === 'transfer-encoding') return;
    res.setHeader(key, value);
  });
  if (!webResponse.body) {
    res.end();
    return;
  }
  // Streamed rather than buffered so an SSE body reaches the client frame by
  // frame; a plain JSON body is a single chunk and behaves identically.
  const reader = webResponse.body.getReader();
  res.on('close', () => void reader.cancel().catch(() => {}));
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!res.write(Buffer.from(value))) {
      await new Promise<void>((resolve) => res.once('drain', resolve));
    }
  }
  res.end();
}

/** Mount one moved route module (its GET/POST/… exports) as an Express handler. */
export function mountRoute(mod: unknown): RequestHandler {
  const handlers = mod as RouteModule;
  return (req, res, next) => {
    const handler: RouteHandler | undefined = METHODS.includes(req.method as Method)
      ? handlers[req.method as Method]
      : undefined;
    if (!handler) {
      res.status(405).json({ error: `Method ${req.method} not allowed` });
      return;
    }
    if (JSON_REQUIRED.has(req.method) && !isJsonContentType(req.headers['content-type'])) {
      res.status(415).json({
        error: `${req.method} requires "content-type: application/json".`,
      });
      return;
    }
    void (async () => {
      try {
        const params = Promise.resolve(req.params as Record<string, string>);
        const result = await handler(toWebRequest(req), { params });
        await send(res, result);
      } catch (err) {
        next(err);
      }
    })();
  };
}
