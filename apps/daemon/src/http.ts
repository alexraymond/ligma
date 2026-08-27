/**
 * The web-standard Request/Response names the route handlers were written
 * against.
 *
 * The handlers moved out of Next.js unchanged: they still take a Request and
 * return a Response, they still call `NextResponse.json(...)`. Rather than
 * rewrite every one into Express's (req, res) style — and risk a shape drifting
 * — the daemon keeps the handler signature and adapts it at the edge
 * (routes/adapter.ts). `NextResponse` is Node's own `Response`, whose static
 * `json()` is the same thing Next's was.
 */

export const NextResponse = Response;
export type NextResponse = Response;

/** The Request the adapter hands to a handler: a Request with a parsed `nextUrl`. */
export class DaemonRequest extends Request {
  readonly nextUrl: URL;

  constructor(input: string, init?: RequestInit) {
    super(input, init);
    this.nextUrl = new URL(this.url);
  }
}

export const NextRequest = DaemonRequest;
export type NextRequest = DaemonRequest;

/** A moved Next.js route handler, unchanged. */
export type RouteHandler = (
  request: NextRequest,
  context: { params: Promise<Record<string, string>> },
) => Response | Promise<Response>;

/** The shape of a moved route module: one exported function per HTTP method. */
export type RouteModule = Partial<
  Record<'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', RouteHandler>
>;
