/**
 * Live per-agent-backend status probe (OD-061, OD-065, OD-086, OD-088,
 * OD-117–119, OD-128) — settings needs "is claude/codex/gemini actually
 * usable right now", answered WITHOUT spawning a model turn.
 *
 * Binary resolution is not reimplemented here. `runner.ts` already resolves
 * config overrides, common install paths and `which`/`where` inside
 * `findCliBinary`/`detectCliBinary` — neither is exported (that file isn't
 * this feature's to touch), but the class method built on top of them,
 * `AgentRunner.probeBackend`, is. This module calls that (contract's "dormant
 * probeBackend") instead of duplicating detection logic.
 *
 * `--version` is universal across all three CLIs' own `--help` output. Auth
 * status is NOT: only `claude auth status --json` was verified against a real
 * installed CLI (`claude auth --help` lists `login`/`logout`/`status`, and
 * `status --json` returns `{ loggedIn, authMethod, ... }` in well under a
 * second — no network-bound interactive flow). `gemini --help` lists no
 * `auth` subcommand at all, and codex wasn't installed on this machine to
 * verify against real `--help` output — inventing a flag for either would
 * violate the "never guess a CLI's surface" rule, so both honestly report
 * `authStatus: "unknown"` rather than a guessed answer.
 */

import { execFile } from 'node:child_process';
import type { RunFailureCause } from '@ligma/api';
import { loadConfig } from './config';
import { AgentRunner } from './runner';
import type { Backend } from './types';

const PROBE_TIMEOUT_MS = 5000;

/**
 * Minimal promise wrapper — `util.promisify(execFile)` relies on Node's own
 * `execFile[util.promisify.custom]` to return `{ stdout, stderr }`, which a
 * plain mock in tests doesn't carry. A callback read directly off `execFile`
 * needs no such magic and mocks with an ordinary `(bin, args, opts, cb) =>
 * cb(null, "...")`.
 */
function runCli(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: PROBE_TIMEOUT_MS }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.toString());
    });
  });
}

export type AuthStatus = 'authenticated' | 'unauthenticated' | 'unknown';

/** The failure-card family only knows `env`/`auth` here — see classify.ts's `classifyCause`. */
export type BackendCauseKind = Extract<RunFailureCause, 'env' | 'auth'>;

export interface BackendProbe {
  backend: Backend;
  available: boolean;
  /** Resolved binary path, or the bare backend name when resolution failed. */
  path: string;
  /** `--version` stdout, trimmed. `null` when unavailable or the flag failed. */
  version: string | null;
  /** `execution.<backend>BinaryPath` from daemon-config.json, or `null` if unset. */
  configuredPath: string | null;
  authStatus: AuthStatus;
  /** Structured cause for `<FailureCard>` — never parsed from `message` prose. */
  causeKind: BackendCauseKind | null;
  /** Raw daemon-side detail, shown as supplementary text only. */
  message: string | null;
  probedAt: string;
}

const CONFIG_KEY: Record<Backend, 'claudeBinaryPath' | 'codexBinaryPath' | 'geminiBinaryPath'> = {
  claude: 'claudeBinaryPath',
  codex: 'codexBinaryPath',
  gemini: 'geminiBinaryPath',
};

const BACKENDS: readonly Backend[] = ['claude', 'codex', 'gemini'];

async function versionOf(binPath: string): Promise<string | null> {
  try {
    const stdout = await runCli(binPath, ['--version']);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Only claude has a verified cheap auth check; see module doc for why. */
async function authStatusOf(backend: Backend, binPath: string): Promise<AuthStatus> {
  if (backend !== 'claude') return 'unknown';
  try {
    const stdout = await runCli(binPath, ['auth', 'status', '--json']);
    const parsed: unknown = JSON.parse(stdout);
    if (typeof parsed === 'object' && parsed !== null && 'loggedIn' in parsed) {
      return (parsed as { loggedIn: unknown }).loggedIn === true
        ? 'authenticated'
        : 'unauthenticated';
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

async function probeOne(backend: Backend): Promise<BackendProbe> {
  const resolved = AgentRunner.probeBackend(backend);
  const configuredPath = loadConfig().execution[CONFIG_KEY[backend]] ?? null;
  const probedAt = new Date().toISOString();

  if (!resolved.available) {
    return {
      backend,
      available: false,
      path: resolved.path,
      version: null,
      configuredPath,
      authStatus: 'unknown',
      causeKind: 'env',
      message: resolved.message ?? null,
      probedAt,
    };
  }

  const [version, authStatus] = await Promise.all([
    versionOf(resolved.path),
    authStatusOf(backend, resolved.path),
  ]);

  return {
    backend,
    available: true,
    path: resolved.path,
    version,
    configuredPath,
    authStatus,
    causeKind: authStatus === 'unauthenticated' ? 'auth' : null,
    message: resolved.message ?? null,
    probedAt,
  };
}

// ponytail: a plain module-level Map with one expiry check, not a cache
// library. Invalidated explicitly on Rescan and on a *BinaryPath hot-reload
// (engine/lifecycle.ts); the TTL is only the backstop for the changes nothing
// tells us about — a CLI installed, upgraded or logged out from underneath us,
// which used to leave `probedAt` frozen at the first probe forever (P10).
const PROBE_TTL_MS = 5 * 60_000;
const cache = new Map<Backend, BackendProbe>();

function fresh(probe: BackendProbe | undefined, now: number): BackendProbe | null {
  if (!probe) return null;
  const at = Date.parse(probe.probedAt);
  return Number.isFinite(at) && now - at < PROBE_TTL_MS ? probe : null;
}

/** All three backends, from cache where available. `force` clears the cache first (Rescan). */
export async function probeAllBackends(force = false): Promise<BackendProbe[]> {
  if (force) cache.clear();
  const now = Date.now();
  return Promise.all(
    BACKENDS.map(async (backend) => {
      const cached = fresh(cache.get(backend), now);
      if (cached) return cached;
      const probe = await probeOne(backend);
      cache.set(backend, probe);
      return probe;
    }),
  );
}

/** Exposed for tests / callers that invalidate without immediately re-probing. */
export function invalidateBackendProbeCache(): void {
  cache.clear();
}
