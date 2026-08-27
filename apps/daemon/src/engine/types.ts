// ─── Daemon Configuration ────────────────────────────────────────────────────

export interface ScheduleEntry {
  enabled: boolean;
  cron: string;
  command: string;
}

/** Acceptance-harness settings (execution.harness). Missing block ⇒ these defaults. */
export interface HarnessConfig {
  /** Pick up awaiting-verification tasks from the daemon poll cycle. */
  autoVerify: boolean;
  /** Persona spawns running at once inside ONE verification run. */
  maxParallelPersonas: number;
  /** How many independent naive-user runs the full roster does. */
  naiveUserRuns: number;
  /**
   * Verification runs one task may accumulate before it stops being selected and
   * gets a Blocked report + decision card naming the real reason (D4).
   */
  maxVerificationAttempts: number;
  /**
   * Model for the judge spawn. MUST be set and MUST differ from the builder's
   * model — judge.ts refuses to run otherwise (docs/history/CONTRACTS.md §6).
   */
  judgeModel: string | null;
  /** Model for every browser/terminal-driving persona spawn. null = CLI default. */
  personaModel: string | null;
}

/** The CLI backends the daemon can spawn. */
export type Backend = 'claude' | 'codex' | 'gemini';

/**
 * Every spawn the governor accounts for.
 *
 * The first four are autonomous — they answer to the reserve floor, which exists
 * to keep Alex's own interactive headroom out of the daemon's reach. "human" is
 * the human asking directly (Talk), so the reserve does NOT apply to it: the
 * reserve IS the human's, and spending it on their own question is the reserve
 * working, not leaking. It is still gated by the kill switch and by the absolute
 * window ceiling — the ceiling is the subscription, which nobody can vote past.
 */
export type GovernorRole = 'builder' | 'persona' | 'judge' | 'scheduled' | 'human';

/**
 * What a spawn is FOR, which decides its tool grant and its deny rules (D9/D7),
 * and is also passed through to the child as `LIGMA_SPAWN_ROLE` (see
 * `buildSafeEnv`) so a stand-in CLI — e.g. drill mode's fake-claude — can reply
 * in the shape the calling role's parser expects without reading the prompt.
 * Only the builder gets Bash; only scheduled commands and brain-dump triage are
 * allowed near the raw task store. "judge", "persona" and "discovery" carry no
 * extra deny rules of their own (same default as an undeclared role) — they
 * exist here purely for the env passthrough.
 */
export type SpawnRole =
  | 'builder'
  | 'scheduled'
  | 'inbox'
  | 'triage'
  | 'judge'
  | 'persona'
  | 'discovery'
  | 'talk';

/**
 * Quota governor settings (execution.governor). Missing block ⇒ these defaults,
 * which means gating is ON by default: the Claude subscription is a quota, not a
 * bill (docs/history/harvest.md §1.9), and an advisory-only limiter is the mistake
 * builderz-labs made with its workload ladder (§1.7).
 */
export interface GovernorConfig {
  enabled: boolean;
  /** Rolling window the session count is measured over. */
  windowHours: number;
  /** Total claude sessions the window may contain (subscription quota proxy). */
  maxSessionsPerWindow: number;
  /**
   * Share of the window kept for Alex's own interactive use. Autonomous roles
   * are blocked once the remainder is spent — the daemon never touches this.
   */
  reservePercent: number;
  /** Config half of the kill switch; `data/governor-kill` is the other half. */
  killSwitch: boolean;
  /**
   * Which backend each role spawns on. Partial by design — an unrouted role
   * falls back to claude (`resolveRoleBackend`), which is what every config
   * written before a role existed says by omission.
   */
  roleRouting: {
    builder: Backend;
    persona: Backend;
    judge: Backend;
    scheduled?: Backend;
    human?: Backend;
  };
}

export interface DaemonConfig {
  polling: {
    enabled: boolean;
    intervalMinutes: number;
  };
  concurrency: {
    maxParallelAgents: number;
  };
  schedule: Record<string, ScheduleEntry>;
  execution: {
    maxTurns: number;
    timeoutMinutes: number;
    retries: number;
    retryDelayMinutes: number;
    skipPermissions: boolean;
    allowedTools: string[];
    agentTeams: boolean;
    claudeBinaryPath: string | null;
    backendMode: 'claude' | 'mixed' | 'codex' | 'gemini';
    codexTaskTags: string[];
    codexBinaryPath: string | null;
    codexModel: string | null;
    geminiTaskTags: string[];
    geminiBinaryPath: string | null;
    geminiModel: string | null;
    claudeAutoFailoverEnabled: boolean;
    claudeAutoFailoverThreshold: number;
    claudeAutoFailoverBackend: 'codex' | 'gemini' | null;
    /** Model for builder task spawns, studio/discovery worker turns — every non-judge, non-persona spawn. null = CLI default. */
    workerModel: string | null;
    /**
     * Cross-session agent memory (OD-092). `enabled` gates the READ path only —
     * off means prompts carry no `## What you remember` section; the stored
     * notes stay on disk and the routes keep working.
     */
    memory: {
      enabled: boolean;
      /** Per-agent cap; oldest unpinned notes are evicted past it. */
      maxEntries: number;
    };
    harness: HarnessConfig;
    governor: GovernorConfig;
  };
  /**
   * Where product-repo.ts provisions/finds product checkouts (OD-097). Missing
   * block ⇒ productsDir: null, which falls through to the `~/ligma-products`
   * default — `LIGMA_PRODUCTS_DIR` still wins over this either way.
   */
  storage: {
    productsDir: string | null;
  };
  /** Desktop notifications on build completion / verdicts (OD-096). Missing block ⇒ off. */
  notifications: {
    /** Fire a macOS `osascript` notification. No-ops on non-macOS regardless. */
    desktopEnabled: boolean;
  };
}

// ─── Agent Sessions ──────────────────────────────────────────────────────────

export type SessionStatus = 'running' | 'completed' | 'failed' | 'timeout';

export interface AgentSession {
  id: string;
  agentId: string;
  taskId: string | null;
  command: string;
  pid: number;
  startedAt: string;
  status: SessionStatus;
  retryCount: number;
}

export interface SessionHistoryEntry {
  id: string;
  agentId: string;
  taskId: string | null;
  command: string;
  pid: number;
  startedAt: string;
  completedAt: string;
  status: SessionStatus;
  exitCode: number | null;
  error: string | null;
  durationMinutes: number;
  retryCount: number;
}

// ─── Daemon Status ───────────────────────────────────────────────────────────

export type DaemonRunStatus = 'running' | 'stopped' | 'starting';

export interface DaemonStats {
  tasksDispatched: number;
  tasksCompleted: number;
  tasksFailed: number;
  uptimeMinutes: number;
}

/** What the governor reports to the status file and the dashboard. */
export interface GovernorStatus {
  enabled: boolean;
  windowHours: number;
  /** Claude sessions inside the current window. */
  used: number;
  max: number;
  /** Autonomy stops here; the gap to `max` is Alex's reserve. */
  reserveFloor: number;
  remainingForAutonomy: number;
  backends: Record<Backend, { state: 'ready' | 'cooling'; coolingUntil: string | null }>;
  killSwitch: boolean;
}

export interface DaemonStatus {
  status: DaemonRunStatus;
  pid: number | null;
  startedAt: string | null;
  activeSessions: AgentSession[];
  history: SessionHistoryEntry[];
  /**
   * taskId → how many BUILDER attempts on it have ended badly, ever.
   *
   * Persisted separately from `history` because history is a 50-row ring: a task
   * parked at the retry cap ("not being picked up again without a human") had
   * its failure rows evicted after ~50 sessions, `getRetryCount` fell back to 0,
   * and the task was silently retried forever at ~50-session intervals (E4).
   * Small and append-only — one integer per task that has ever failed a build.
   *
   * Optional because a status file written before this existed does not have it
   * (and neither do the fixtures that hand-build a status). `getStatus()` always
   * writes it.
   */
  retryCounts?: Record<string, number>;
  stats: DaemonStats;
  lastPollAt: string | null;
  nextScheduledRuns: Record<string, string>;
  governor: GovernorStatus;
}

// ─── Runner Types ────────────────────────────────────────────────────────────

export interface SpawnOptions {
  prompt: string;
  maxTurns: number;
  timeoutMinutes: number;
  skipPermissions: boolean;
  allowedTools?: string[];
  /**
   * Permission DENY rules (claude `--disallowedTools`), e.g.
   * `Read(//abs/path/**)`. Defaults to `denyRulesForRole(role)` — the compiled
   * contracts are denied to every spawn, the task store to all but scheduled and
   * triage (D7).
   */
  disallowedTools?: string[];
  /**
   * Decides the default deny rules. Absent ⇒ contracts-only (the safe subset).
   * Also forwarded to the child as `LIGMA_SPAWN_ROLE` (see `buildSafeEnv` /
   * `AgentRunner.spawnAgent`).
   */
  role?: SpawnRole;
  agentTeams?: boolean;
  cwd: string;
  onSpawnPid?: (pid: number) => void;
  onStdoutChunk?: (chunk: string) => void;
  onStderrChunk?: (chunk: string) => void;
  backend?: 'claude' | 'codex' | 'gemini';
  /** Passed as `--model` to the claude backend only (judge/builder separation). */
  model?: string | null;
  codexModel?: string | null;
  geminiModel?: string | null;
}

export interface SpawnResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /**
   * Wall-clock time the child process was alive. Set by every real spawn.
   *
   * Optional because not every SpawnResult comes from one: `dispatcher.ts`
   * synthesizes results for paths where nothing was spawned at all, and those
   * have no duration to report. Absent means "never measured" — which is not
   * `0`, and writing 0 there would put a fabricated measurement in the ledger.
   */
  durationMs?: number;
  /**
   * Token usage as the backend's own envelope reported it. NEVER estimated — a
   * guessed token count is worse than a gap, because it looks like a measurement.
   *
   * Three states, all distinct: absent (nothing parsed this), null (the envelope
   * was parsed and carried no usage), a number (the backend said so).
   */
  tokensIn?: number | null;
  tokensOut?: number | null;
}

// ─── Log Levels ──────────────────────────────────────────────────────────────

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'SECURITY';
