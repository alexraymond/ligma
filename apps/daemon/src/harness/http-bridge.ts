/**
 * http-bridge.ts — the API transport of the persona bridge.
 *
 * A headless product has no screen, so a browser panel proves nothing about it.
 * The persona drives the ephemeral env's HTTP surface instead: it asks the bridge
 * to make a call, the bridge makes it, and writes the whole request/response as
 * an artifact. Evidence is `records/NN-<method>-<path>.json` — status codes and
 * derived response schemas where a browser run would have screenshots.
 *
 * Same rules as the browser transport, which is the point of the exercise:
 *   - the origin lock is absolute — a path or a URL on the product origin, and
 *     nothing else, so a persona cannot call the open internet or another env;
 *   - a failed call is recorded, not swallowed: a 500 is data about the product,
 *     so it is a successful bridge action with a record, never a bridge error;
 *   - the persona cannot forge a record, because it never writes one.
 *
 * Schemas, not bodies, are what a baseline compares: `describeShape` reduces a
 * response to `{id:string,tags:string[]}`, with keys sorted so a serializer that
 * reorders them is not mistaken for a regression.
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { scrubCredentials } from '../engine/security';
import {
  ACTION_TIMEOUT_MS,
  type Bridge,
  type BridgeHandler,
  SessionRecorder,
  type StepEvidence,
  serveBridge,
  str,
} from './bridge-server';

/** Response bodies are evidence, not archives. */
const BODY_LIMIT = 8_000;

/** Sent on every call. Anything else the persona asks for is added to these. */
const DEFAULT_HEADERS: Record<string, string> = { accept: 'application/json, text/plain, */*' };

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

export interface HttpBridgeOptions {
  /** The env's product base URL. The ONLY origin this bridge will call. */
  baseUrl: string;
  /** Verification run root: <data>/verification-runs/<runId>. */
  runDir: string;
}

/** One request/response pair, exactly as the bridge saw it. The unit of evidence. */
export interface HttpRecord {
  index: number;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  /** null when the request could not be made at all (connection refused, timeout). */
  status: number | null;
  statusText: string;
  responseHeaders: Record<string, string>;
  contentType: string | null;
  /** Derived shape of a JSON body — what the baseline records and compares. */
  schema: string | null;
  body: string;
  bodyTruncated: boolean;
  durationMs: number;
  error: string | null;
  at: string;
}

/**
 * A value's shape, as a stable one-line string: `{id:string,done:boolean}`.
 *
 * Keys are sorted and arrays are described by their first element — a baseline
 * must flag "the id became a number", never "the server reordered its JSON".
 */
export function describeShape(value: unknown, depth = 0): string {
  if (value === null) return 'null';
  if (Array.isArray(value))
    return value.length === 0 ? 'unknown[]' : `${describeShape(value[0], depth + 1)}[]`;
  if (typeof value !== 'object') return typeof value;
  if (depth >= 5) return 'object';
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 60);
  return `{${entries.map(([k, v]) => `${k}:${describeShape(v, depth + 1)}`).join(',')}}`;
}

/** The response's schema, or null when the body was not JSON. */
export function schemaOf(body: string, contentType: string | null): string | null {
  if (contentType && !/json/i.test(contentType)) return null;
  try {
    return describeShape(JSON.parse(body));
  } catch {
    return null;
  }
}

/**
 * Headers whose VALUE is a credential by definition. `scrubCredentials` catches
 * secrets that look like secrets; these do not need to look like anything, so
 * they are redacted by name — an evidence file is read by humans and by the
 * judge, and a session cookie in one is a session cookie leaked.
 */
const SECRET_HEADERS = new Set([
  'set-cookie',
  'cookie',
  'authorization',
  'proxy-authorization',
  'x-api-key',
]);

export function redactHeaders(entries: Iterable<[string, string]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of entries) {
    const key = k.toLowerCase();
    out[key] = SECRET_HEADERS.has(key) ? '[redacted]' : scrubCredentials(v);
  }
  return out;
}

class HttpSession extends SessionRecorder {
  readonly records: HttpRecord[] = [];
  private readonly recordsDir = this.subdir('records');
  /** Evidence of the action currently being performed, for stepEvidence(). */
  lastRecord: string | null = null;
  lastUrl = '';

  /** Persist one record and return its run-relative path. */
  write(record: HttpRecord): string {
    const slug =
      `${record.method}-${new URL(record.url).pathname}`
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .slice(0, 48) || 'request';
    const file = `${String(record.index).padStart(2, '0')}-${slug}.json`;
    writeFileSync(
      path.join(this.recordsDir, file),
      `${JSON.stringify(record, null, 2)}\n`,
      'utf-8',
    );
    this.records.push(record);
    return this.rel('records', file);
  }
}

const MUTATING = new Set(['request']);

export async function startHttpBridge(opts: HttpBridgeOptions): Promise<Bridge> {
  const origin = new URL(opts.baseUrl).origin;

  /** Resolve a persona-supplied target, refusing anything off the product origin. */
  const resolveUrl = (raw: string): URL => {
    const target = new URL(raw, `${origin}/`);
    if (target.origin !== origin) {
      throw Object.assign(
        new Error(`Refusing to call ${target.origin}: the product under test is ${origin}`),
        {
          statusCode: 403,
        },
      );
    }
    return target;
  };

  const handler: BridgeHandler<HttpSession> = {
    mutating: MUTATING,

    async newSession(name) {
      return new HttpSession(name, opts.runDir);
    },

    async stepEvidence(session): Promise<StepEvidence> {
      return { record: session.lastRecord, url: session.lastUrl };
    },

    async close() {
      // Nothing owns a socket: fetch() closes its own.
    },

    async perform(session, action, body) {
      switch (action) {
        case 'request': {
          session.lastRecord = null;
          session.lastUrl = '';

          const method = (str(body.method) ?? 'GET').toUpperCase();
          if (!METHODS.has(method)) throw new Error(`request: unsupported method "${method}"`);
          const target = str(body.path) ?? str(body.url);
          if (!target) throw new Error('request needs { path } (or { url } on the product origin)');
          const url = resolveUrl(target);
          session.lastUrl = url.toString();

          const extra =
            body.headers && typeof body.headers === 'object'
              ? (body.headers as Record<string, unknown>)
              : {};
          const headers: Record<string, string> = { ...DEFAULT_HEADERS };
          for (const [k, v] of Object.entries(extra))
            if (typeof v === 'string') headers[k.toLowerCase()] = v;

          // `json` is the ergonomic form; `body` is the escape hatch for sending
          // something deliberately malformed, which is the saboteur's whole job.
          let payload: string | null = null;
          if (typeof body.body === 'string') payload = body.body;
          else if (body.json !== undefined) {
            payload = JSON.stringify(body.json);
            headers['content-type'] ??= 'application/json';
          }

          const index = session.records.length + 1;
          const t0 = Date.now();
          const at = new Date().toISOString();

          let record: HttpRecord;
          try {
            const res = await fetch(url, {
              method,
              headers,
              body: payload === null || method === 'GET' || method === 'HEAD' ? undefined : payload,
              // Manual: a redirect is behaviour worth recording, and following one
              // blindly is how a persona ends up off the product origin.
              redirect: 'manual',
              signal: AbortSignal.timeout(ACTION_TIMEOUT_MS),
            });
            const raw = scrubCredentials(await res.text());
            const text = raw.slice(0, BODY_LIMIT);
            const contentType = res.headers.get('content-type');
            record = {
              index,
              method,
              url: url.toString(),
              requestHeaders: redactHeaders(Object.entries(headers)),
              requestBody: payload === null ? null : scrubCredentials(payload).slice(0, BODY_LIMIT),
              status: res.status,
              statusText: res.statusText,
              responseHeaders: redactHeaders(res.headers as unknown as Iterable<[string, string]>),
              contentType,
              schema: schemaOf(text, contentType),
              body: text,
              bodyTruncated: raw.length > text.length,
              durationMs: Date.now() - t0,
              error: null,
              at,
            };
          } catch (err) {
            // A product that refuses the connection is a finding, not a bridge
            // malfunction — record it and hand the persona the same shape.
            record = {
              index,
              method,
              url: url.toString(),
              requestHeaders: redactHeaders(Object.entries(headers)),
              requestBody: payload,
              status: null,
              statusText: '',
              responseHeaders: {},
              contentType: null,
              schema: null,
              body: '',
              bodyTruncated: false,
              durationMs: Date.now() - t0,
              error: err instanceof Error ? err.message : String(err),
              at,
            };
          }

          session.lastRecord = session.write(record);
          return {
            status: record.status,
            statusText: record.statusText,
            contentType: record.contentType,
            schema: record.schema,
            body: record.body,
            bodyTruncated: record.bodyTruncated,
            durationMs: record.durationMs,
            requestError: record.error,
          };
        }

        case 'records':
          return {
            records: session.records.map((r) => ({
              index: r.index,
              method: r.method,
              url: r.url,
              status: r.status,
              schema: r.schema,
            })),
          };

        case 'base':
          return { baseUrl: origin };

        default:
          throw Object.assign(new Error(`Unknown action "${action}"`), { statusCode: 404 });
      }
    },
  };

  return serveBridge(handler);
}
