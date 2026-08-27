/**
 * The engine loop's own start/stop, separate from the process's.
 *
 * "Stop the daemon" has always meant "stop dispatching" — the UI kept working
 * while the loop was down. The API and the loop share one process now, so a
 * stop that killed the process would take the API down with it. This module is
 * what POST /api/daemon drives: the scheduler and dispatcher go away, in-flight
 * sessions are settled exactly as a SIGTERM settled them, the server keeps
 * serving, and a start puts the loop back without a respawn.
 *
 * The PID file marks the *engine*, not the process — the same thing it marked
 * when the two were inseparable, so status readers did not have to change.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sweepStaleVerificationRuns } from '../harness/verdict';
import { DATA_DIR } from '../paths';
import { invalidateBackendProbeCache } from './backend-probe';
import { loadConfig } from './config';
import { Dispatcher } from './dispatcher';
import { withFileLockAsync, writeJsonAtomic } from './file-lock';
import { HealthMonitor } from './health';
import { logger } from './logger';
import { AgentRunner, clearBinaryCache } from './runner';
import { Scheduler } from './scheduler';

const PID_FILE = path.join(DATA_DIR, 'daemon.pid');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');

/** Uptime tracking, stale-session sweep and config hot-reload cadence. */
const MAINTENANCE_MS = 60_000;

interface RunningEngine {
  health: HealthMonitor;
  runner: AgentRunner;
  scheduler: Scheduler;
  maintenance: ReturnType<typeof setInterval>;
}

let engine: RunningEngine | null = null;

/** True when this process is running the dispatch loop. */
export function isEngineRunning(): boolean {
  return engine !== null;
}

// ─── PID File Management ─────────────────────────────────────────────────────

export function writePidFile(): void {
  writeFileSync(PID_FILE, String(process.pid), 'utf-8');
}

export function readPidFile(): number | null {
  try {
    if (!existsSync(PID_FILE)) return null;
    const pid = Number.parseInt(readFileSync(PID_FILE, 'utf-8').trim());
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

export function removePidFile(): void {
  try {
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  } catch {
    // Best effort
  }
}

async function resetTaskToNotStarted(taskId: string): Promise<void> {
  try {
    await withFileLockAsync('tasks', async () => {
      const tasksRaw = readFileSync(TASKS_FILE, 'utf-8');
      const tasksData = JSON.parse(tasksRaw) as {
        tasks: Array<{ id: string; kanban: string; updatedAt?: string }>;
      };
      const task = tasksData.tasks.find((t) => t.id === taskId);
      if (!task) return;
      // awaiting-verification is a finished build — never re-queue it as fresh work.
      if (task.kanban === 'done' || task.kanban === 'not-started') return;
      if (task.kanban === 'awaiting-verification') return;

      task.kanban = 'not-started';
      task.updatedAt = new Date().toISOString();
      writeJsonAtomic(TASKS_FILE, tasksData);
      logger.info('daemon', `Reset task ${taskId} to not-started during shutdown`);
    });
  } catch (err) {
    logger.error(
      'daemon',
      `Failed to reset task ${taskId} during shutdown: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Stop **one** in-flight session, exactly the way `stopEngine` stops all of
 * them: kill the process tree, return its task to the board, close the session.
 *
 * The per-run interrupt the Runs surface offers (UX spec §6) is this function —
 * the engine already knew how to end a session, it just had no way to be asked
 * about one. Returns false when this process is not running the engine, or the
 * session is not one of its own, so the caller can fall back to the pid it has.
 */
export async function interruptSession(
  sessionId: string,
  reason = 'Stopped by you',
): Promise<boolean> {
  const running = engine;
  if (!running) return false;
  const session = running.health.getSession(sessionId);
  if (!session) return false;

  if (session.pid > 0) await running.runner.killSession(session.pid);
  if (session.taskId) await resetTaskToNotStarted(session.taskId);
  running.health.endSession(session.id, null, reason, false);
  logger.info('daemon', `Session ${sessionId} stopped: ${reason}`);
  return true;
}

// ─── Start / stop ────────────────────────────────────────────────────────────

/**
 * Bring the dispatch loop up in this process. Idempotent: starting a running
 * engine is a no-op, so a double-click on the UI's start button cannot produce
 * two dispatchers over one store.
 */
export async function startEngine(): Promise<void> {
  if (engine) return;

  const config = loadConfig();

  // Security warnings
  if (config.execution.skipPermissions) {
    logger.security('daemon', '============================================================');
    logger.security('daemon', '⚠  skipPermissions is ENABLED');
    logger.security('daemon', '   Claude Code will bypass ALL permission prompts.');
    logger.security('daemon', '   Only use this in trusted, isolated environments.');
    logger.security('daemon', '============================================================');
  } else if (config.execution.allowedTools.length > 0) {
    logger.info('daemon', `Allowed tools: ${config.execution.allowedTools.join(', ')}`);
  }

  // D5: a run killed with the last daemon still says "running" on disk and would
  // hold its task hostage forever. Reclaim the corpses before the first poll.
  const swept = sweepStaleVerificationRuns();
  if (swept.length > 0) {
    logger.warn(
      'daemon',
      `Reclaimed ${swept.length} stale verification run(s): ${swept.join(', ')}`,
    );
  }

  // Initialize components
  const health = new HealthMonitor();
  const runner = new AgentRunner();
  const dispatcher = new Dispatcher(config, runner, health);
  const scheduler = new Scheduler(config, dispatcher, health);

  // Write PID file
  writePidFile();
  logger.info('daemon', `Daemon started (PID: ${process.pid})`);

  // Start scheduler
  scheduler.start();

  // Keep process alive + periodic maintenance
  // The scheduler's cron jobs keep the event loop active,
  // but we add a safety interval for uptime tracking + stale session cleanup + config hot-reload
  let lastConfigJson = JSON.stringify(config);
  /** The binary-path fields, whose cache has to be dropped when they move (P10). */
  const binaryPaths = (c: typeof config): string =>
    `${c.execution.claudeBinaryPath}|${c.execution.codexBinaryPath}|${c.execution.geminiBinaryPath}`;
  let lastBinaryPaths = binaryPaths(config);

  const maintenance = setInterval(() => {
    health.cleanStaleSessions(); // Proactively detect dead PIDs
    health.updateUptime();
    health.flush();

    // Hot-reload config from disk so UI changes take effect without restart
    try {
      const freshConfig = loadConfig();
      const freshJson = JSON.stringify(freshConfig);
      if (freshJson !== lastConfigJson) {
        logger.info('daemon', 'Config change detected — hot-reloading...');
        lastConfigJson = freshJson;
        // Settings pointed the daemon at a different CLI build. Without this the
        // resolved binary stayed cached until a full process restart nothing
        // told the user to do (P10).
        const freshBinaryPaths = binaryPaths(freshConfig);
        if (freshBinaryPaths !== lastBinaryPaths) {
          lastBinaryPaths = freshBinaryPaths;
          clearBinaryCache();
          // The PROBE cache is a second, independent memory of the same
          // resolution ("is claude usable, and where?"), and it has no TTL — so
          // dropping only the binary cache left GET /api/backends reporting the
          // old path forever, `probedAt` frozen at the first probe (P10).
          invalidateBackendProbeCache();
          logger.info(
            'daemon',
            'Backend binary path changed — cleared the resolved-binary and probe caches',
          );
        }
        scheduler.reload(freshConfig);
        logger.info(
          'daemon',
          `Config reloaded: polling=${freshConfig.polling.enabled} (every ${freshConfig.polling.intervalMinutes}min), concurrency=${freshConfig.concurrency.maxParallelAgents}, maxTurns=${freshConfig.execution.maxTurns}, timeout=${freshConfig.execution.timeoutMinutes}min`,
        );
      }
    } catch (err) {
      logger.error(
        'daemon',
        `Config hot-reload failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, MAINTENANCE_MS);

  engine = { health, runner, scheduler, maintenance };

  // Run initial poll immediately
  if (config.polling.enabled) {
    logger.info('daemon', 'Running initial task poll...');
    await dispatcher.pollAndDispatch();
  }

  // Flush status
  health.flush();

  logger.info(
    'daemon',
    `Config: polling=${config.polling.enabled} (every ${config.polling.intervalMinutes}min), concurrency=${config.concurrency.maxParallelAgents}, maxTurns=${config.execution.maxTurns}, timeout=${config.execution.timeoutMinutes}min, allowedTools=[${config.execution.allowedTools.join(',')}]`,
  );
}

/**
 * Take the dispatch loop down. In-flight sessions are settled the way a
 * SIGTERM settled them: killed, their task returned to not-started, the session
 * closed. The HTTP server is not this function's business — the caller decides
 * whether the process itself is going away.
 */
export async function stopEngine(reason: string): Promise<void> {
  const running = engine;
  if (!running) return;
  engine = null;

  logger.info('daemon', `${reason} — stopping the engine loop...`);

  // Stop scheduler (no new dispatches)
  running.scheduler.stop();
  clearInterval(running.maintenance);

  // Kill active sessions
  const activeSessions = running.health.getActiveSessions();
  if (activeSessions.length > 0) {
    logger.info('daemon', `Killing ${activeSessions.length} active session(s)...`);
    for (const session of activeSessions) {
      if (session.pid > 0) {
        await running.runner.killSession(session.pid);
      }
      if (session.taskId) {
        await resetTaskToNotStarted(session.taskId);
      }
      running.health.endSession(session.id, null, 'Daemon shutdown', false);
    }
  }

  // Write stopped status
  running.health.writeStoppedStatus();

  // Remove PID file
  removePidFile();

  logger.info('daemon', 'Daemon stopped.');
}
