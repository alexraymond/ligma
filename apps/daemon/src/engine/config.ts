import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { withFileLock, writeJsonAtomic } from './file-lock';
import { logger } from './logger';
import type { DaemonConfig, SpawnRole } from './types';

import { CENTRAL_PROJECTS_DIR, DATA_DIR } from '../paths';
const CONFIG_FILE = path.join(DATA_DIR, 'daemon-config.json');

// ─── Default Configuration ───────────────────────────────────────────────────

const DEFAULT_CONFIG: DaemonConfig = {
  polling: {
    enabled: true,
    intervalMinutes: 5,
  },
  concurrency: {
    maxParallelAgents: 3,
  },
  schedule: {
    dailyPlan: { enabled: true, cron: '0 7 * * *', command: 'daily-plan' },
    standup: { enabled: true, cron: '0 9 * * 1-5', command: 'standup' },
    brainDumpTriage: { enabled: false, cron: '0 12 * * *', command: 'daily-plan' },
    weeklyReview: { enabled: true, cron: '0 17 * * 5', command: 'weekly-review' },
  },
  execution: {
    maxTurns: 25,
    timeoutMinutes: 30,
    retries: 1,
    retryDelayMinutes: 5,
    skipPermissions: false,
    // The BUILDER's grant (`toolsForRole`), and the builder is the one role that
    // has to run things — `denyRulesForRole`'s own note says so, and D9 says so.
    // Without Bash the default was also the exact set codex can never express
    // (writes but no shell), so `backendMode: "codex"` silently routed to claude
    // instead (E15).
    allowedTools: ['Read', 'Edit', 'Write', 'Bash'],
    agentTeams: false,
    claudeBinaryPath: null,
    backendMode: 'claude',
    codexTaskTags: ['codex'],
    codexBinaryPath: null,
    codexModel: null,
    geminiTaskTags: ['gemini'],
    geminiBinaryPath: null,
    geminiModel: null,
    claudeAutoFailoverEnabled: true,
    claudeAutoFailoverThreshold: 2,
    claudeAutoFailoverBackend: 'codex',
    // Cheap by default: build brief's own rule is "use cheaper models for more
    // manual tasks", and every worker/persona spawn below is exactly that.
    workerModel: 'sonnet',
    // On by default costs nothing: an agent with no memories gets no section.
    memory: {
      enabled: true,
      maxEntries: 50,
    },
    harness: {
      autoVerify: true,
      maxParallelPersonas: 2,
      naiveUserRuns: 3,
      maxVerificationAttempts: 3,
      judgeModel: 'opus',
      personaModel: 'sonnet',
    },
    governor: {
      enabled: true,
      windowHours: 5,
      maxSessionsPerWindow: 40,
      reservePercent: 20,
      killSwitch: false,
      roleRouting: { builder: 'claude', persona: 'claude', judge: 'claude' },
    },
  },
  storage: {
    productsDir: null,
  },
  notifications: {
    desktopEnabled: false,
  },
};

// ─── Validation ──────────────────────────────────────────────────────────────

function validateConfig(config: unknown): DaemonConfig {
  if (typeof config !== 'object' || config === null) {
    throw new Error('Config must be an object');
  }

  const c = config as Record<string, unknown>;
  // Deep clone: the old shallow spread let every merge mutate DEFAULT_CONFIG's
  // nested objects, so a later load() inherited the previous file's values.
  const result: DaemonConfig = structuredClone(DEFAULT_CONFIG);

  // Merge polling
  if (c.polling && typeof c.polling === 'object') {
    const p = c.polling as Record<string, unknown>;
    if (typeof p.enabled === 'boolean') result.polling.enabled = p.enabled;
    if (
      typeof p.intervalMinutes === 'number' &&
      p.intervalMinutes >= 1 &&
      p.intervalMinutes <= 60
    ) {
      result.polling.intervalMinutes = p.intervalMinutes;
    }
  }

  // Merge concurrency
  if (c.concurrency && typeof c.concurrency === 'object') {
    const con = c.concurrency as Record<string, unknown>;
    if (
      typeof con.maxParallelAgents === 'number' &&
      con.maxParallelAgents >= 1 &&
      con.maxParallelAgents <= 10
    ) {
      result.concurrency.maxParallelAgents = con.maxParallelAgents;
    }
  }

  // Merge schedule
  if (c.schedule && typeof c.schedule === 'object') {
    const s = c.schedule as Record<string, unknown>;
    for (const [key, entry] of Object.entries(s)) {
      if (entry && typeof entry === 'object') {
        const e = entry as Record<string, unknown>;
        if (
          typeof e.enabled === 'boolean' &&
          typeof e.cron === 'string' &&
          typeof e.command === 'string'
        ) {
          result.schedule[key] = { enabled: e.enabled, cron: e.cron, command: e.command };
        }
      }
    }
  }

  // Merge execution
  if (c.execution && typeof c.execution === 'object') {
    const ex = c.execution as Record<string, unknown>;
    if (typeof ex.maxTurns === 'number' && ex.maxTurns >= 1 && ex.maxTurns <= 100) {
      result.execution.maxTurns = ex.maxTurns;
    }
    if (
      typeof ex.timeoutMinutes === 'number' &&
      ex.timeoutMinutes >= 1 &&
      ex.timeoutMinutes <= 120
    ) {
      result.execution.timeoutMinutes = ex.timeoutMinutes;
    }
    if (typeof ex.retries === 'number' && ex.retries >= 0 && ex.retries <= 5) {
      result.execution.retries = ex.retries;
    }
    if (
      typeof ex.retryDelayMinutes === 'number' &&
      ex.retryDelayMinutes >= 1 &&
      ex.retryDelayMinutes <= 30
    ) {
      result.execution.retryDelayMinutes = ex.retryDelayMinutes;
    }
    if (typeof ex.skipPermissions === 'boolean') {
      result.execution.skipPermissions = ex.skipPermissions;
    }
    if (Array.isArray(ex.allowedTools)) {
      const validTools = (ex.allowedTools as unknown[])
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map((t) => t.trim());
      result.execution.allowedTools = validTools;
    }
    if (typeof ex.agentTeams === 'boolean') {
      result.execution.agentTeams = ex.agentTeams;
    }
    if (typeof ex.claudeBinaryPath === 'string') {
      result.execution.claudeBinaryPath = ex.claudeBinaryPath;
    } else if (ex.claudeBinaryPath === null) {
      result.execution.claudeBinaryPath = null;
    }
    if (
      ex.backendMode === 'claude' ||
      ex.backendMode === 'mixed' ||
      ex.backendMode === 'codex' ||
      ex.backendMode === 'gemini'
    ) {
      result.execution.backendMode = ex.backendMode;
    }
    if (Array.isArray(ex.codexTaskTags)) {
      const validTags = (ex.codexTaskTags as unknown[])
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map((t) => t.trim().toLowerCase());
      result.execution.codexTaskTags = [...new Set(validTags)];
    }
    if (typeof ex.codexBinaryPath === 'string') {
      result.execution.codexBinaryPath = ex.codexBinaryPath;
    } else if (ex.codexBinaryPath === null) {
      result.execution.codexBinaryPath = null;
    }
    if (typeof ex.codexModel === 'string') {
      result.execution.codexModel = ex.codexModel;
    } else if (ex.codexModel === null) {
      result.execution.codexModel = null;
    }
    if (Array.isArray(ex.geminiTaskTags)) {
      const validTags = (ex.geminiTaskTags as unknown[])
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map((t) => t.trim().toLowerCase());
      result.execution.geminiTaskTags = [...new Set(validTags)];
    }
    if (typeof ex.geminiBinaryPath === 'string') {
      result.execution.geminiBinaryPath = ex.geminiBinaryPath;
    } else if (ex.geminiBinaryPath === null) {
      result.execution.geminiBinaryPath = null;
    }
    if (typeof ex.geminiModel === 'string') {
      result.execution.geminiModel = ex.geminiModel;
    } else if (ex.geminiModel === null) {
      result.execution.geminiModel = null;
    }
    if (typeof ex.claudeAutoFailoverEnabled === 'boolean') {
      result.execution.claudeAutoFailoverEnabled = ex.claudeAutoFailoverEnabled;
    }
    if (
      typeof ex.claudeAutoFailoverThreshold === 'number' &&
      ex.claudeAutoFailoverThreshold >= 1 &&
      ex.claudeAutoFailoverThreshold <= 10
    ) {
      result.execution.claudeAutoFailoverThreshold = ex.claudeAutoFailoverThreshold;
    }
    if (
      ex.claudeAutoFailoverBackend === 'codex' ||
      ex.claudeAutoFailoverBackend === 'gemini' ||
      ex.claudeAutoFailoverBackend === null
    ) {
      result.execution.claudeAutoFailoverBackend = ex.claudeAutoFailoverBackend;
    }
    if (typeof ex.workerModel === 'string' && ex.workerModel.trim().length > 0) {
      result.execution.workerModel = ex.workerModel.trim();
    } else if (ex.workerModel === null) {
      result.execution.workerModel = null;
    }

    // Cross-session memory (OD-092). Bounds MUST match src/store/validations.ts
    // (1..500) — a value one validator takes and the other drops is the config
    // drift the harness bounds comment above exists to warn about.
    if (ex.memory && typeof ex.memory === 'object') {
      const m = ex.memory as Record<string, unknown>;
      if (typeof m.enabled === 'boolean') result.execution.memory.enabled = m.enabled;
      if (typeof m.maxEntries === 'number' && m.maxEntries >= 1 && m.maxEntries <= 500) {
        result.execution.memory.maxEntries = m.maxEntries;
      }
    }

    // Acceptance harness — a missing block keeps the defaults above.
    if (ex.harness && typeof ex.harness === 'object') {
      const h = ex.harness as Record<string, unknown>;
      const harness = result.execution.harness;
      if (typeof h.autoVerify === 'boolean') harness.autoVerify = h.autoVerify;
      if (
        typeof h.maxParallelPersonas === 'number' &&
        h.maxParallelPersonas >= 1 &&
        h.maxParallelPersonas <= 8
      ) {
        harness.maxParallelPersonas = h.maxParallelPersonas;
      }
      if (typeof h.naiveUserRuns === 'number' && h.naiveUserRuns >= 1 && h.naiveUserRuns <= 5) {
        harness.naiveUserRuns = h.naiveUserRuns;
      }
      // Bounds MUST match src/lib/validations.ts (1..10): a value one validator
      // accepts and the other silently drops is the config-drift bug this pass exists to kill.
      if (
        typeof h.maxVerificationAttempts === 'number' &&
        h.maxVerificationAttempts >= 1 &&
        h.maxVerificationAttempts <= 10
      ) {
        harness.maxVerificationAttempts = h.maxVerificationAttempts;
      }
      if (typeof h.judgeModel === 'string' && h.judgeModel.trim().length > 0) {
        harness.judgeModel = h.judgeModel.trim();
      } else if (h.judgeModel === null) {
        harness.judgeModel = null;
      }
      if (typeof h.personaModel === 'string' && h.personaModel.trim().length > 0) {
        harness.personaModel = h.personaModel.trim();
      } else if (h.personaModel === null) {
        harness.personaModel = null;
      }
    }

    // Quota governor — a missing block keeps the defaults above, which means
    // gating is on. Same manual-validation style as the rest of this file.
    if (ex.governor && typeof ex.governor === 'object') {
      const g = ex.governor as Record<string, unknown>;
      const gov = result.execution.governor;
      if (typeof g.enabled === 'boolean') gov.enabled = g.enabled;
      if (typeof g.windowHours === 'number' && g.windowHours >= 1 && g.windowHours <= 168) {
        gov.windowHours = g.windowHours;
      }
      if (
        typeof g.maxSessionsPerWindow === 'number' &&
        g.maxSessionsPerWindow >= 1 &&
        g.maxSessionsPerWindow <= 1000
      ) {
        gov.maxSessionsPerWindow = g.maxSessionsPerWindow;
      }
      if (
        typeof g.reservePercent === 'number' &&
        g.reservePercent >= 0 &&
        g.reservePercent <= 100
      ) {
        gov.reservePercent = g.reservePercent;
      }
      if (typeof g.killSwitch === 'boolean') gov.killSwitch = g.killSwitch;
      if (g.roleRouting && typeof g.roleRouting === 'object') {
        const r = g.roleRouting as Record<string, unknown>;
        for (const role of ['builder', 'persona', 'judge', 'scheduled'] as const) {
          const value = r[role];
          if (value !== 'claude' && value !== 'codex' && value !== 'gemini') continue;
          // E6: routing the judge off claude VALIDATES today and then cannot
          // work — `assertJudgeModel` plus decideBackend's pinned-model rejection
          // make every judge spawn fail closed, and `remainingForRole("judge")`
          // answers Infinity for a non-claude role, so the panels are unbounded
          // and each one burns a verification attempt to the cap. A config that
          // cannot work is a config error, not a per-run error: it is refused
          // here, out loud, and the default (claude) stands.
          if (role === 'judge' && value !== 'claude') {
            logger.error(
              'config',
              `execution.governor.roleRouting.judge="${value}" is not runnable: the judge pins a model and only the claude CLI can honour that, so every verification would fail closed. Keeping judge=claude.`,
            );
            continue;
          }
          gov.roleRouting[role] = value;
        }
      }
    }
  }

  // Merge storage (OD-097's product-repo root override).
  if (c.storage && typeof c.storage === 'object') {
    const s = c.storage as Record<string, unknown>;
    if (typeof s.productsDir === 'string' && s.productsDir.trim().length > 0) {
      result.storage.productsDir = s.productsDir.trim();
    } else if (s.productsDir === null) {
      result.storage.productsDir = null;
    }
  }

  // Merge notifications (OD-096's desktop-notification toggle).
  if (c.notifications && typeof c.notifications === 'object') {
    const n = c.notifications as Record<string, unknown>;
    if (typeof n.desktopEnabled === 'boolean') {
      result.notifications.desktopEnabled = n.desktopEnabled;
    }
  }

  return result;
}

// ─── Load / Save ─────────────────────────────────────────────────────────────

export function loadConfig(): DaemonConfig {
  try {
    if (!existsSync(CONFIG_FILE)) {
      logger.info('config', 'No config file found, creating with defaults');
      saveConfig(DEFAULT_CONFIG);
      return { ...DEFAULT_CONFIG };
    }

    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    const config = validateConfig(parsed);

    // Security warning for skipPermissions
    if (config.execution.skipPermissions) {
      logger.security(
        'config',
        '⚠ skipPermissions is ENABLED — Claude Code will bypass all permission prompts',
      );
    } else if (config.execution.allowedTools.length > 0) {
      logger.info('config', `Allowed tools: ${config.execution.allowedTools.join(', ')}`);
    }

    return config;
  } catch (err) {
    logger.error(
      'config',
      `Failed to load config: ${err instanceof Error ? err.message : String(err)}`,
    );
    logger.info('config', 'Using default configuration');
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Write daemon-config.json under the same cross-process lock and the same
 * temp-file + rename `store/data.ts`'s `mutateDaemonConfig` takes ("daemon-config"
 * is `lockName("daemon-config.json")`, the identical lock directory).
 *
 * This is only ever the self-heal below — a fresh install with no config file —
 * but "only ever" is exactly when a truncated write is unrecoverable: it raced
 * `PATCH /api/daemon`'s locked read-modify-write with an unlocked truncate, and
 * the loser was the whole configuration.
 */
export function saveConfig(config: DaemonConfig): void {
  withFileLock('daemon-config', () => writeJsonAtomic(CONFIG_FILE, config));
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

// ─── Per-role tool grants and deny rules (D9 / D7) ───────────────────────────

/** Only the builder gets Bash: it is the one role that has to run things. */
const NON_BUILDER_TOOLS = ['Read', 'Edit', 'Write'];

const CONTRACTS_GLOB = path.join(DATA_DIR, 'contracts', '**');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
/** Baselines and regression probes — the journey oracle (twin-primitives §3). */
const CENTRAL_PROJECTS_GLOB = path.join(CENTRAL_PROJECTS_DIR, '**');

/**
 * The two roles that write nothing at all: they are handed their context in the
 * prompt and return a JSON reply the daemon writes itself
 * (`engine/run-talk-respond.ts`, `engine/run-inbox-respond.ts`). Read-only, no
 * shell — the most restrictive grant in this file.
 *
 * `inbox` joined `talk` here when the inbox pass stopped asking the model to
 * hand-edit `inbox.json` (E10): its Edit/Write existed only to serve that, and
 * a spawn whose whole prompt is somebody else's untrusted message text is the
 * last one that should hold a pen over the store.
 */
const COMPOSE_ONLY_TOOLS = ['Read'];

/**
 * The tools a spawn of this role may use.
 *
 * The builder keeps the configured set (Bash included — the acceptance harness
 * needs it to run things). Brain-dump triage and scheduled commands compose text
 * and edit JSON; granting them a shell was the real over-grant, so they get
 * Read/Edit/Write and nothing else.
 */
export function toolsForRole(role: SpawnRole): string[] {
  if (role === 'talk' || role === 'inbox') return [...COMPOSE_ONLY_TOOLS];
  return role === 'builder' ? loadConfig().execution.allowedTools : [...NON_BUILDER_TOOLS];
}

/**
 * Claude permission-rule deny list keeping the oracle away from the agent (D7).
 *
 * Rule syntax is the CLI's own: `Read(//abs/path/**)` — a leading `//` marks an
 * absolute path (verified against the installed binary's own examples,
 * `Read(~/**)` / `Edit(//etc/*)`), and Read rules also govern Glob/Grep while
 * Edit rules govern every file-writing tool.
 *
 * ponytail: a tool-level deny is the strongest thing the CLI can express. It
 * does NOT stop `Bash("cat data/contracts/…")`, and the builder keeps Bash by
 * design (D9) — so this narrows the leak, it does not seal it. Sealing it needs
 * the contracts stored outside the builder's filesystem.
 */
export function denyRulesForRole(role?: SpawnRole): string[] {
  // Nothing legitimately reads a compiled contract from a spawned CLI: the judge
  // gets it inlined in its prompt, the builder is only ever shown the visible slice.
  // Journeys are in the repo on purpose; their baselines are not. A builder that
  // can read "what working currently looks like" can build to the baseline
  // instead of to the product (twin-primitives §3).
  const paths = [CONTRACTS_GLOB, CENTRAL_PROJECTS_GLOB];
  // Scheduled commands and triage create and edit tasks for a living; the rest
  // (builder, inbox, and any spawn that did not declare a role) do not need them.
  if (role === 'builder' || role === 'inbox') paths.push(TASKS_FILE);
  return paths.flatMap((p) => [`Read(/${p})`, `Edit(/${p})`]);
}
