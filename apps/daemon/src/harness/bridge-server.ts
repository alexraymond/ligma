/**
 * bridge-server.ts — the plumbing every bridge shares, and the contract every
 * bridge honours.
 *
 * A bridge is the ONLY way a persona agent may touch the product. There are
 * four transports — a browser (Chromium), an HTTP client, a subprocess in the
 * ephemeral env, and the env's files for a product that does not run at all —
 * and downstream nothing knows which one ran: the judge, the
 * verdict, the evidence locker and the baselines all read `BridgeStep` and files
 * under `personas/<name>/`.
 *
 * The four hard rules that used to live in browser-bridge.ts live here, so they
 * hold for every transport rather than for whichever one was written first:
 *   1. The handler's own origin/scope check runs before anything is performed
 *      (each bridge refuses to leave the product it was pointed at).
 *   2. Every mutating action appends a step BEFORE returning, including its
 *      error, so a failed action is evidence rather than a silent gap.
 *   3. Every request must carry the SESSION'S OWN unguessable token, minted here
 *      and handed only to that persona. Without it the bridge was open to any
 *      local process — and, since it answers on 127.0.0.1 with no Host check, to
 *      any web page via DNS rebinding.
 *   4. The Host header must be loopback. A rebound hostname is refused before
 *      anything else happens.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { BridgeStep } from './types';

export type { BridgeStep };

/**
 * Which bridge a persona drives. Chosen from project shape + journey tags.
 * `fs` is the artifact transport: a project that is not a running program is
 * read and cited rather than driven (execution-flow review H5).
 */
export type BridgeTransport = 'browser' | 'http' | 'pty' | 'fs';

/** Per-action cap: a wrong selector, a hung endpoint or a stuck CLI fails fast. */
export const ACTION_TIMEOUT_MS = 10_000;

export interface BridgeSession {
  /**
   * Base URL the persona curls — a capability URL, i.e. the session's token is
   * a path segment: http://127.0.0.1:53321/s/naive-user-1/<token>
   * Give it to that persona and no other.
   */
  url: string;
  /** This session's token, on its own. Same secret that is embedded in `url`. */
  token: string;
  /** Path of this session's steps.jsonl, relative to the run root. */
  stepsPath: string;
}

export interface Bridge {
  url: string;
  /** Register a persona's isolated session. `name` becomes personas/<name>/. */
  session(name: string): Promise<BridgeSession>;
  close(): Promise<void>;
}

/**
 * A persona's evidence directory and its step ledger. Every transport's session
 * type extends this, which is what keeps `personas/<name>/steps.jsonl` the one
 * shape the judge reads.
 */
export class SessionRecorder {
  readonly relDir: string;
  /** Unguessable per-session capability token (128 bits). */
  readonly token = randomBytes(16).toString('hex');
  readonly dir: string;
  private readonly stepsFile: string;
  private stepIndex = 0;

  constructor(
    readonly name: string,
    runDir: string,
  ) {
    this.relDir = path.posix.join('personas', name);
    this.dir = path.join(runDir, 'personas', name);
    mkdirSync(this.dir, { recursive: true });
    this.stepsFile = path.join(this.dir, 'steps.jsonl');
  }

  /** Absolute path of a subdirectory of this persona's evidence dir. */
  subdir(name: string): string {
    const dir = path.join(this.dir, name);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** Run-relative posix path inside this persona's evidence dir. */
  rel(...parts: string[]): string {
    return path.posix.join(this.relDir, ...parts);
  }

  recordStep(step: Omit<BridgeStep, 'index'>): BridgeStep {
    this.stepIndex += 1;
    const full: BridgeStep = { index: this.stepIndex, ...step };
    appendFileSync(this.stepsFile, `${JSON.stringify(full)}\n`, 'utf-8');
    return full;
  }

  get steps(): number {
    return this.stepIndex;
  }
}

/** Evidence attached to a recorded step, whatever the transport captured. */
export interface StepEvidence {
  screenshot?: string | null;
  record?: string | null;
  url?: string;
}

/** What a transport must supply to become a bridge. */
export interface BridgeHandler<S extends SessionRecorder> {
  /** Actions that change the product, and therefore become evidence steps. */
  mutating: ReadonlySet<string>;
  /** Do the thing. Throw to make it an error step; `statusCode` sets the reply. */
  perform(
    session: S,
    action: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  /** Evidence for a recorded step — a screenshot, an artifact path, a url. */
  stepEvidence(session: S, action: string, failed: boolean): Promise<StepEvidence>;
  newSession(name: string): Promise<S>;
  close(): Promise<void>;
}

// ─── HTTP plumbing ───────────────────────────────────────────────────────────

export function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      // 10k-char paste tests are the point; 1MB is the ceiling.
      if (size > 1_000_000) reject(new Error('request body too large'));
      else chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8').trim();
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return reject(new Error('body must be a JSON object'));
        }
        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(new Error('body is not valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** Non-empty string or null — the one argument coercion every bridge uses. */
export const str = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Host header must name loopback: an attacker-controlled name is a rebinding attempt. */
export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false; // HTTP/1.1 requires it; a missing Host is not a client we serve.
  const name = host.replace(/:\d+$/, '');
  return LOOPBACK_HOSTS.has(name.toLowerCase());
}

/** Constant-time compare that also tolerates a wrong-length candidate. */
export function tokenMatches(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Stand the control server up and return the Bridge the run holds. One server
 * per run, bound to 127.0.0.1 on an OS-assigned port.
 */
export async function serveBridge<S extends SessionRecorder>(
  handler: BridgeHandler<S>,
): Promise<Bridge> {
  const sessions = new Map<string, S>();

  const server = http.createServer((req, res) => {
    void (async () => {
      const send = (status: number, payload: unknown): void => {
        const body = JSON.stringify(payload);
        res.writeHead(status, {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        });
        res.end(body);
      };

      // A rebound DNS name resolving to 127.0.0.1 dies here, before anything else.
      if (!isLoopbackHost(req.headers.host)) {
        return send(403, { error: 'bridge: refusing a non-loopback Host header' });
      }

      // /s/<session>/<token>/<action>
      const parts = (req.url ?? '').split('?')[0].split('/').filter(Boolean);
      if (parts.length !== 4 || parts[0] !== 's') {
        return send(404, { error: 'Use /s/<session>/<token>/<action>' });
      }
      const [, sessionName, token, action] = parts;

      // One generic answer for "no such session" and "wrong token": the bridge
      // must not confirm which personas exist to a caller that cannot authenticate.
      const session = sessions.get(sessionName);
      if (!session || !tokenMatches(session.token, token)) {
        return send(403, { error: 'bridge: unauthorized' });
      }

      let body: Record<string, unknown> = {};
      if (req.method === 'POST') {
        try {
          body = await readBody(req);
        } catch (err) {
          return send(400, { error: err instanceof Error ? err.message : String(err) });
        }
      }

      const startedAt = new Date().toISOString();
      const t0 = Date.now();
      let result: Record<string, unknown> | null = null;
      let error: string | null = null;
      let status = 200;

      try {
        result = await handler.perform(session, action, body);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        status = (err as { statusCode?: number }).statusCode ?? 400;
      }

      if (handler.mutating.has(action)) {
        const evidence = await handler
          .stepEvidence(session, action, error !== null)
          .catch(() => ({}) as StepEvidence);
        const step = session.recordStep({
          action,
          detail: JSON.stringify(body).slice(0, 500),
          url: evidence.url ?? '',
          startedAt,
          durationMs: Date.now() - t0,
          screenshot: evidence.screenshot ?? null,
          record: evidence.record ?? null,
          error,
        });
        if (result) result.step = step.index;
        for (const key of ['screenshot', 'record'] as const) {
          const value = evidence[key];
          if (!value) continue;
          if (result) result[key] = value;
          else result = { [key]: value };
        }
      }

      if (error) return send(status, { error, ...(result ?? {}) });
      return send(200, { ok: true, ...result });
    })();
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') return reject(new Error('bridge got no port'));
      resolve(addr.port);
    });
  });

  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    url: baseUrl,
    async session(name: string): Promise<BridgeSession> {
      if (sessions.has(name)) throw new Error(`Bridge session "${name}" already exists`);
      const session = await handler.newSession(name);
      sessions.set(name, session);
      return {
        url: `${baseUrl}/s/${name}/${session.token}`,
        token: session.token,
        stepsPath: path.posix.join('personas', name, 'steps.jsonl'),
      };
    },
    async close(): Promise<void> {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await handler.close().catch(() => undefined);
    },
  };
}
