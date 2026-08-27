/**
 * quota-governor.ts — the single enforcement point for the scarce resource.
 *
 * The Claude subscription has no dollar cost; it has a quota (docs/history/harvest.md
 * §1.9). So the thing to ration is *sessions per rolling window*, and the thing
 * to protect is Alex's own interactive headroom — a daemon that spends the last
 * session of the window has taken Claude away from its owner.
 *
 * Two rules make this a governor rather than a dashboard:
 *
 * 1. It GATES. Every `claude -p` spawn path calls `canSpawn()` first and honours
 *    the answer. builderz-labs' workload ladder was advisory and nothing read it
 *    (§1.7); that is the failure mode this file exists to avoid.
 * 2. Denial is a queue, never a failure. A denied builder stays `not-started` and
 *    is picked up next cycle; a denied persona mid-panel WAITS, because the
 *    sessions already spent on that panel are wasted if the panel is abandoned.
 *
 * The only thing that aborts work in flight is the kill switch — config flag OR
 * the presence of `data/governor-kill`, so it can be thrown from a shell without
 * editing JSON.
 *
 * Ledger: `data/quota-ledger.json`, one entry per spawn, pruned to the window on
 * every write, guarded by the same `withFileLock` mkdir mutex the daemon uses for
 * tasks.json (so the daemon, run-task and run-verification processes agree).
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunFailureCause } from '@ligma/api';
import { cachedConfig } from './config-cache';
import { withFileLock } from './file-lock';
import { logger } from './logger';
import type { Backend, GovernorConfig, GovernorRole, GovernorStatus } from './types';

import { DATA_DIR as DEFAULT_DATA_DIR } from '../paths';
const LOCK_NAME = 'quota-ledger';

/**
 * Where the ledger and kill file live. `MC_GOVERNOR_DATA_DIR` redirects both —
 * the same env-redirection trick the ephemeral-env lifecycle uses, so tests (and
 * throwaway runs) can exercise the gate without touching the real quota window.
 * Resolved per call, not at import time, so setting the var later still works.
 */
function dataDir(): string {
  return process.env.MC_GOVERNOR_DATA_DIR ?? DEFAULT_DATA_DIR;
}

export function ledgerFilePath(): string {
  return path.join(dataDir(), 'quota-ledger.json');
}

export function killSwitchFilePath(): string {
  return path.join(dataDir(), 'governor-kill');
}

export const BACKENDS: readonly Backend[] = ['claude', 'codex', 'gemini'];

/** Exit code meaning "the governor deferred this run" — not a failure. */
export const DEFERRED_EXIT_CODE = 3;

const HOUR_MS = 60 * 60 * 1000;
const BACKOFF_BASE_MS = 60 * 1000;
const BACKOFF_CAP_MS = 30 * 60 * 1000;

// ─── Ledger shape ────────────────────────────────────────────────────────────

export interface LedgerEntry {
  ts: string;
  backend: Backend;
  role: GovernorRole;
  /** taskId for builders, runId (+persona name) for harness spawns. */
  ref: string | null;
  /**
   * Annotated by `recordSpawnOutcome` once the spawn finishes — the entry is
   * written BEFORE the spawn (that is the whole point of claiming a slot), so
   * these can only ever arrive late. Absent means "not yet, or never recorded";
   * a null token count means "the backend's envelope carried no usage".
   */
  durationMs?: number;
  tokensIn?: number | null;
  tokensOut?: number | null;
}

export interface BackendState {
  /** Consecutive availability failures — drives the backoff. */
  failures: number;
  coolingUntil: string | null;
}

export interface Ledger {
  spawns: LedgerEntry[];
  backends: Partial<Record<Backend, BackendState>>;
}

export type DenyReason = 'kill-switch' | 'reserve' | 'window-exhausted' | 'backend-cooling';

export type GovernorDecision =
  | { allowed: true; backend: Backend }
  | { allowed: false; reason: DenyReason; retryInMs: number; backend: Backend };

/**
 * A denial, as the two fields a deferred run carries (UX spec F5: "Deferred by
 * governor, resumes ~14:30").
 *
 * Both come from the decision this module already made — `reason` is a closed
 * union, so nothing downstream has to read words out of an error string. The
 * one judgement call: a KILL SWITCH gets no `resumesAt`. It resumes when a
 * human removes the file, and a card promising a time for a stop somebody
 * deliberately threw would be a lie with a clock on it.
 */
export function deferralFields(
  decision: { reason: DenyReason; retryInMs: number },
  now = Date.now(),
): { causeKind: RunFailureCause; resumesAt?: string } {
  if (decision.reason === 'kill-switch') return { causeKind: 'rate-limit' };
  return {
    causeKind: 'rate-limit',
    resumesAt: new Date(now + Math.max(0, decision.retryInMs)).toISOString(),
  };
}

/**
 * Thrown when the governor will not grant a slot (kill switch, timeout, or an
 * immediate denial a caller chose not to wait out).
 *
 * It carries `deferralFields`' own answer so a caller re-raising this over HTTP
 * has the structured cause to hand without re-deciding anything: `rate-limit`,
 * and when the governor can name one, the time a slot comes back.
 */
export class GovernorAbort extends Error {
  readonly causeKind: RunFailureCause;
  readonly resumesAt: string | null;

  constructor(
    message: string,
    fields: { causeKind: RunFailureCause; resumesAt?: string } = { causeKind: 'rate-limit' },
  ) {
    super(message);
    this.name = 'GovernorAbort';
    this.causeKind = fields.causeKind;
    this.resumesAt = fields.resumesAt ?? null;
  }
}

// ─── Pure math (unit-testable without touching disk) ─────────────────────────

/**
 * Sessions the daemon may use before it starts eating Alex's reserve.
 *
 * Floors at 1 whenever the window has any capacity at all: floor(1 * 0.8) = 0
 * denied every autonomous spawn with reason "reserve" on a completely empty
 * ledger, so a small window meant "the daemon never runs" rather than "the
 * daemon runs a little". A configured window of N always permits at least one.
 */
export function reserveFloor(maxSessionsPerWindow: number, reservePercent: number): number {
  if (maxSessionsPerWindow <= 0) return 0;
  const pct = Math.min(100, Math.max(0, reservePercent));
  const floor = Math.floor(maxSessionsPerWindow * (1 - pct / 100));
  // A 100% reserve is an explicit "no autonomy" and is honoured. Anything less
  // must leave the daemon at least one spawn: rounding it to zero turned "keep a
  // fifth back" into "never run" for any small window.
  return floor > 0 || pct >= 100 ? floor : 1;
}

/** 1m → 2m → 4m … capped at 30m. `failures` is 1-based. */
export function coolingBackoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_CAP_MS);
}

/** Entries still inside the window, oldest first. Anything unparseable is dropped. */
export function pruneSpawns(spawns: LedgerEntry[], now: number, windowMs: number): LedgerEntry[] {
  return spawns
    .filter((e) => {
      const ts = Date.parse(e.ts);
      return Number.isFinite(ts) && now - ts < windowMs;
    })
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

/**
 * When the k-th oldest in-window entry expires — i.e. how long until `k` slots
 * come back. Clamped to 1s so a caller never busy-loops on a 0ms retry.
 */
function freeInMs(inWindow: LedgerEntry[], k: number, windowMs: number, now: number): number {
  const entry = inWindow[Math.max(0, k - 1)];
  if (!entry) return 1000;
  return Math.max(1000, Date.parse(entry.ts) + windowMs - now);
}

export interface DecideInput {
  config: GovernorConfig;
  ledger: Ledger;
  role: GovernorRole;
  backend: Backend;
  killFilePresent: boolean;
  now: number;
}

/**
 * The whole decision, as a function of state. No IO, so the acceptance arithmetic
 * (window pruning, reserve floor, cooling) is testable without spawning anything.
 */
export function decide(input: DecideInput): GovernorDecision {
  const { config, ledger, role, backend, killFilePresent, now } = input;

  // Kill switch is checked before `enabled`: a stop that a config flag can
  // disable is not a kill switch.
  if (config.killSwitch || killFilePresent) {
    return { allowed: false, reason: 'kill-switch', retryInMs: BACKOFF_BASE_MS, backend };
  }

  /**
   * The human asking directly (Talk) answers to the kill switch and the absolute
   * window ceiling, and to nothing else.
   *
   * NOT the reserve floor: the reserve exists to hold sessions back FOR Alex, so
   * denying Alex's own question to protect Alex's headroom would be the governor
   * defeating its own purpose. NOT backend cooling either — cooling is a backoff
   * for autonomous retry loops, and one person typing one message is neither a
   * loop nor something to make them wait out. The ceiling still binds, because
   * the ceiling is the subscription itself and no role can vote past it.
   */
  if (role === 'human') {
    if (!config.enabled || backend !== 'claude') return { allowed: true, backend };
    const windowMs = Math.max(1, config.windowHours) * HOUR_MS;
    const inWindow = pruneSpawns(ledger.spawns, now, windowMs).filter(
      (e) => e.backend === 'claude',
    );
    const max = config.maxSessionsPerWindow;
    if (inWindow.length >= max) {
      return {
        allowed: false,
        reason: 'window-exhausted',
        retryInMs: freeInMs(inWindow, inWindow.length - max + 1, windowMs, now),
        backend,
      };
    }
    return { allowed: true, backend };
  }

  const state = ledger.backends[backend];
  if (state?.coolingUntil) {
    const until = Date.parse(state.coolingUntil);
    if (Number.isFinite(until) && until > now) {
      return { allowed: false, reason: 'backend-cooling', retryInMs: until - now, backend };
    }
  }

  if (!config.enabled) return { allowed: true, backend };

  // v1: only the Claude subscription is window-limited. gemini/codex still get
  // cooling above, they just aren't the scarce resource.
  if (backend !== 'claude') return { allowed: true, backend };

  const windowMs = Math.max(1, config.windowHours) * HOUR_MS;
  const inWindow = pruneSpawns(ledger.spawns, now, windowMs).filter((e) => e.backend === 'claude');
  const used = inWindow.length;
  const max = config.maxSessionsPerWindow;
  const floor = reserveFloor(max, config.reservePercent);

  if (used >= max) {
    return {
      allowed: false,
      reason: 'window-exhausted',
      retryInMs: freeInMs(inWindow, used - max + 1, windowMs, now),
      backend,
    };
  }
  if (used >= floor) {
    return {
      allowed: false,
      reason: 'reserve',
      retryInMs: freeInMs(inWindow, used - floor + 1, windowMs, now),
      backend,
    };
  }
  return { allowed: true, backend };
}

// ─── Ledger IO ───────────────────────────────────────────────────────────────

/** A fresh object every time: callers mutate what they get back. */
function emptyLedger(): Ledger {
  return { spawns: [], backends: {} };
}

/** Tolerant read: a missing or corrupt ledger is an empty one, never a throw. */
export function readLedger(): Ledger {
  try {
    const file = ledgerFilePath();
    if (!existsSync(file)) return emptyLedger();
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as Partial<Ledger>;
    return {
      spawns: Array.isArray(parsed.spawns) ? parsed.spawns : [],
      backends: parsed.backends && typeof parsed.backends === 'object' ? parsed.backends : {},
    };
  } catch {
    logger.warn('governor', 'Quota ledger unreadable — treating the window as empty');
    return emptyLedger();
  }
}

function writeLedgerAtomic(ledger: Ledger): void {
  const file = ledgerFilePath();
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(ledger, null, 2), 'utf-8');
  renameSync(tmp, file);
}

/** Read-modify-write under the cross-process lock. Prunes on every write. */
function mutateLedger(fn: (ledger: Ledger) => void): void {
  const windowMs = Math.max(1, governorConfig().windowHours) * HOUR_MS;
  withFileLock(LOCK_NAME, () => {
    const ledger = readLedger();
    fn(ledger);
    ledger.spawns = pruneSpawns(ledger.spawns, Date.now(), windowMs);
    writeLedgerAtomic(ledger);
  });
}

// ─── Config ──────────────────────────────────────────────────────────────────

function governorConfig(): GovernorConfig {
  // Cached on the config file's mtime: this runs on every decision, every
  // awaitSpawn poll and every health flush.
  return cachedConfig().execution.governor;
}

export function isKillSwitchActive(): boolean {
  return governorConfig().killSwitch || existsSync(killSwitchFilePath());
}

/** The backend a role spawns on, per `execution.governor.roleRouting`. */
export function resolveRoleBackend(role: GovernorRole): Backend {
  const routing = governorConfig().roleRouting;
  return routing[role] ?? 'claude';
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * The gate. `backendOverride` lets a caller that already resolved a backend by
 * other means (builder tag routing, failover rotation) be judged against the
 * right quota — a gemini spawn must not be charged to the Claude window.
 */
export function canSpawn(role: GovernorRole, backendOverride?: Backend): GovernorDecision {
  return decide({
    config: governorConfig(),
    ledger: readLedger(),
    role,
    backend: backendOverride ?? resolveRoleBackend(role),
    killFilePresent: existsSync(killSwitchFilePath()),
    now: Date.now(),
  });
}

/**
 * Decide AND book the slot in one locked read-modify-write.
 *
 * canSpawn() + recordSpawn() is check-then-act: the dispatcher and a detached
 * run-verification child could both read `used === floor - 1`, both be allowed,
 * and both spawn — the governor's entire purpose defeated by a race it could not
 * see. Every gate that is about to spawn must use this instead.
 *
 * A denial writes nothing, so denial stays free.
 */
export function claimSpawn(
  role: GovernorRole,
  opts: { backend?: Backend; ref?: string | null } = {},
): GovernorDecision {
  const backend = opts.backend ?? resolveRoleBackend(role);
  const config = governorConfig();
  const killFilePresent = existsSync(killSwitchFilePath());
  const windowMs = Math.max(1, config.windowHours) * HOUR_MS;

  try {
    return withFileLock(LOCK_NAME, () => {
      const now = Date.now();
      const ledger = readLedger();
      const decision = decide({ config, ledger, role, backend, killFilePresent, now });
      if (decision.allowed) {
        ledger.spawns.push({
          ts: new Date(now).toISOString(),
          backend,
          role,
          ref: opts.ref ?? null,
        });
        ledger.spawns = pruneSpawns(ledger.spawns, now, windowMs);
        writeLedgerAtomic(ledger);
      }
      return decision;
    });
  } catch (err) {
    // A ledger we cannot write is a governor we cannot trust. Fail closed: an
    // unbooked spawn is how the quota gets silently overspent.
    logger.error(
      'governor',
      `Failed to claim a ${role}/${backend} slot: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { allowed: false, reason: 'window-exhausted', retryInMs: BACKOFF_BASE_MS, backend };
  }
}

/**
 * Undo a `claimSpawn()` booking that never turned into a real spawn — the
 * caller aborted before the process started (e.g. dispatch threw building the
 * prompt). Removes the most recent matching entry, never all of them, so an
 * earlier genuine spawn under the same ref keeps its place in the ledger.
 */
export function refundSpawn(role: GovernorRole, ref: string | null, backend: Backend): void {
  try {
    mutateLedger((ledger) => {
      for (let i = ledger.spawns.length - 1; i >= 0; i--) {
        const entry = ledger.spawns[i];
        if (entry.role === role && entry.ref === ref && entry.backend === backend) {
          ledger.spawns.splice(i, 1);
          return;
        }
      }
    });
  } catch (err) {
    logger.error(
      'governor',
      `Failed to refund a ${role}/${backend} slot (ref=${ref}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** One `claude -p` spawn = one entry. Call immediately before spawning. */
export function recordSpawn(role: GovernorRole, ref: string | null, backend?: Backend): void {
  const resolved = backend ?? resolveRoleBackend(role);
  try {
    mutateLedger((ledger) => {
      ledger.spawns.push({ ts: new Date().toISOString(), backend: resolved, role, ref });
    });
  } catch (err) {
    logger.error(
      'governor',
      `Failed to record spawn (${role}/${resolved}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Annotate the entry a `claimSpawn` already booked with what the spawn cost.
 *
 * The booking happens before the process starts — that is what makes the gate a
 * gate — so duration and tokens can only be filled in afterwards. Matches the
 * most recent role/ref/backend entry, exactly as `refundSpawn` does, so a task
 * that was retried on the same backend annotates THIS attempt and leaves the
 * earlier one's numbers alone.
 *
 * Never throws and never invents: a spawn whose envelope carried no usage stores
 * nulls, and an entry that has already been pruned out of the window is simply
 * not found. Neither is worth failing a run over.
 */
export function recordSpawnOutcome(
  role: GovernorRole,
  ref: string | null,
  backend: Backend,
  outcome: { durationMs?: number; tokensIn?: number | null; tokensOut?: number | null },
): void {
  try {
    mutateLedger((ledger) => {
      for (let i = ledger.spawns.length - 1; i >= 0; i--) {
        const entry = ledger.spawns[i];
        if (entry.role === role && entry.ref === ref && entry.backend === backend) {
          // Only what was actually measured. A field the caller did not supply
          // stays absent rather than being written as 0 or null, so "nobody
          // measured this" never becomes a reading of zero.
          if (outcome.durationMs !== undefined) entry.durationMs = outcome.durationMs;
          if (outcome.tokensIn !== undefined) entry.tokensIn = outcome.tokensIn;
          if (outcome.tokensOut !== undefined) entry.tokensOut = outcome.tokensOut;
          return;
        }
      }
    });
  } catch (err) {
    logger.error(
      'governor',
      `Failed to record spawn outcome (${role}/${backend}, ref=${ref}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** A real 429/unavailable answer from a backend — start (or extend) cooling. */
export function recordAvailabilityFailure(backend: Backend): void {
  try {
    mutateLedger((ledger) => {
      const prev = ledger.backends[backend] ?? { failures: 0, coolingUntil: null };
      const failures = prev.failures + 1;
      const coolingUntil = new Date(Date.now() + coolingBackoffMs(failures)).toISOString();
      ledger.backends[backend] = { failures, coolingUntil };
      logger.warn(
        'governor',
        `Backend ${backend} cooling until ${coolingUntil} (failure #${failures})`,
      );
    });
  } catch (err) {
    logger.error(
      'governor',
      `Failed to record availability failure: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** A clean run clears the backoff. */
export function recordSuccess(backend: Backend): void {
  const current = readLedger().backends[backend];
  if (!current || (current.failures === 0 && current.coolingUntil === null)) return;
  try {
    mutateLedger((ledger) => {
      ledger.backends[backend] = { failures: 0, coolingUntil: null };
    });
    logger.info('governor', `Backend ${backend} recovered — cooling cleared`);
  } catch (err) {
    logger.error(
      'governor',
      `Failed to clear cooling: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function status(): GovernorStatus {
  const config = governorConfig();
  const ledger = readLedger();
  const now = Date.now();
  const windowMs = Math.max(1, config.windowHours) * HOUR_MS;
  const used = pruneSpawns(ledger.spawns, now, windowMs).filter(
    (e) => e.backend === 'claude',
  ).length;
  const floor = reserveFloor(config.maxSessionsPerWindow, config.reservePercent);

  const backends = {} as GovernorStatus['backends'];
  for (const backend of BACKENDS) {
    const state = ledger.backends[backend];
    const until = state?.coolingUntil ? Date.parse(state.coolingUntil) : Number.NaN;
    const cooling = Number.isFinite(until) && until > now;
    backends[backend] = {
      state: cooling ? 'cooling' : 'ready',
      coolingUntil: cooling ? state!.coolingUntil : null,
    };
  }

  return {
    enabled: config.enabled,
    windowHours: config.windowHours,
    used,
    max: config.maxSessionsPerWindow,
    reserveFloor: floor,
    remainingForAutonomy: Math.max(0, floor - used),
    backends,
    killSwitch: config.killSwitch || existsSync(killSwitchFilePath()),
  };
}

/**
 * How many autonomous spawns the window still has for `role`'s backend.
 *
 * A pure read over `status()` — it decides nothing and books nothing. It exists
 * so a caller that is about to fan out into N sessions (a verification run: its
 * whole persona panel plus a judge) can ask "can the window afford all of it?"
 * BEFORE starting the first one, instead of finding out halfway through with the
 * evidence already half-spent.
 *
 * `Infinity` when the window does not apply: the governor disabled, or this
 * role routed off claude, which is the only backend v1 counts (see `decide`).
 */
export function remainingForRole(role: GovernorRole): number {
  const config = governorConfig();
  if (!config.enabled) return Number.POSITIVE_INFINITY;
  if (resolveRoleBackend(role) !== 'claude') return Number.POSITIVE_INFINITY;
  return status().remainingForAutonomy;
}
