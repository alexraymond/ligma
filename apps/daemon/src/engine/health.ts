import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { logger } from './logger';
import { status as governorStatus } from './quota-governor';
import { scrubCredentials } from './security';
import type { AgentSession, DaemonStats, DaemonStatus, SessionHistoryEntry } from './types';

import { DATA_DIR } from '../paths';
const STATUS_FILE = path.join(DATA_DIR, 'daemon-status.json');
const MAX_HISTORY = 50;

/**
 * Check if a process is still running by sending signal 0.
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class HealthMonitor {
  private activeSessions: Map<string, AgentSession> = new Map();
  private history: SessionHistoryEntry[] = [];
  /** taskId → failed builder attempts, kept outside the 50-row history ring (E4). */
  private retryCounts: Record<string, number> = {};
  /**
   * Sessions seen with a dead pid once. A session gets one sweep's grace before
   * being written off, so a child that exited cleanly a moment ago is settled by
   * its own `exit` handler rather than double-ended here as a failure (E23).
   */
  private suspectedDead: Set<string> = new Set();
  private stats: DaemonStats = {
    tasksDispatched: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    uptimeMinutes: 0,
  };
  private startedAt: string;
  private lastPollAt: string | null = null;
  private nextScheduledRuns: Record<string, string> = {};

  constructor() {
    this.startedAt = new Date().toISOString();
    this.loadPersistedStats();
  }

  // ─── Session Management ──────────────────────────────────────────────────

  startSession(agentId: string, taskId: string | null, command: string, pid: number): string {
    const id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const session: AgentSession = {
      id,
      agentId,
      taskId,
      command,
      pid,
      startedAt: new Date().toISOString(),
      status: 'running',
      retryCount: 0,
    };
    this.activeSessions.set(id, session);
    this.stats.tasksDispatched++;
    logger.info(
      'health',
      `Session started: ${id} (agent=${agentId}, task=${taskId || 'scheduled'}, pid=${pid})`,
    );
    this.flush();
    return id;
  }

  /**
   * Update the PID of an active session (set after spawn resolves).
   */
  updateSessionPid(sessionId: string, pid: number): void {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.pid = pid;
      logger.debug('health', `Session ${sessionId} PID updated to ${pid}`);
    }
  }

  endSession(
    sessionId: string,
    exitCode: number | null,
    error: string | null,
    timedOut: boolean,
  ): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      logger.warn('health', `Attempted to end unknown session: ${sessionId}`);
      return;
    }

    this.activeSessions.delete(sessionId);

    const completedAt = new Date().toISOString();
    const startTime = new Date(session.startedAt).getTime();
    const durationMinutes = Math.round(((Date.now() - startTime) / 60_000) * 100) / 100;

    const status = timedOut ? 'timeout' : exitCode === 0 ? 'completed' : 'failed';

    const historyEntry: SessionHistoryEntry = {
      ...session,
      completedAt,
      status,
      exitCode,
      error: error ? scrubCredentials(error).slice(0, 500) : null,
      durationMinutes,
    };

    this.history.unshift(historyEntry);
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(0, MAX_HISTORY);
    }

    // The durable half of the retry budget. Same rule `getRetryCount` used to
    // read off the ring — a BUILDER attempt (command "task") that did not
    // complete — but recorded where eviction cannot reach it (E4).
    if (session.command === 'task' && session.taskId && status !== 'completed') {
      this.retryCounts[session.taskId] = (this.retryCounts[session.taskId] ?? 0) + 1;
    }
    this.suspectedDead.delete(sessionId);

    if (status === 'completed') {
      this.stats.tasksCompleted++;
      logger.info('health', `Session completed: ${sessionId} (${durationMinutes}min)`);
    } else {
      this.stats.tasksFailed++;
      logger.error(
        'health',
        `Session ${status}: ${sessionId} (exit=${exitCode}, error=${error?.slice(0, 100) || 'none'})`,
      );
    }

    this.flush();
  }

  /**
   * Close a session that never really ran because the quota governor deferred it.
   * Deliberately writes NO history entry: `getRetryCount()` counts non-completed
   * history rows, so a history entry here would burn a retry for work that was
   * never attempted.
   */
  deferSession(sessionId: string, reason: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;
    this.activeSessions.delete(sessionId);
    // startSession() counted this as dispatched; it wasn't.
    this.stats.tasksDispatched = Math.max(0, this.stats.tasksDispatched - 1);
    logger.info('health', `Session deferred: ${sessionId} (${reason})`);
    this.flush();
  }

  // ─── Queries ──────────────────────────────────────────────────────────────

  activeCount(): number {
    return this.activeSessions.size;
  }

  isTaskRunning(taskId: string): boolean {
    for (const session of this.activeSessions.values()) {
      if (session.taskId === taskId) return true;
    }
    return false;
  }

  isCommandRunning(command: string): boolean {
    for (const session of this.activeSessions.values()) {
      if (session.command === command) return true;
    }
    return false;
  }

  getSession(sessionId: string): AgentSession | undefined {
    return this.activeSessions.get(sessionId);
  }

  getActiveSessions(): AgentSession[] {
    return Array.from(this.activeSessions.values());
  }

  /**
   * How many BUILDER attempts on this task ended badly — the crash-retry budget
   * `execution.retries` caps, and nothing else.
   *
   * `command === "task"` is the whole of M4. Verification runs are started with
   * the SAME taskId under command "verify" (dispatcher.dispatchVerifications),
   * so a run the governor denied or the harness broke — both exit non-zero, both
   * write a "failed" row — used to spend the builder's retries on something the
   * builder never did: with `retries: 1`, two denied panels parked a task whose
   * every build had exited 0. A send-back is healthy; a crash is not. The
   * verification side has its own cap (verificationAttempts, D4), so nothing is
   * left unprotected by this.
   *
   * Read from the durable per-task tally, not the history ring: the ring holds
   * 50 rows GLOBALLY, so a task parked at the cap un-parked itself once its
   * failures aged out and was retried forever after (E4). The ring is still
   * consulted for rows recorded before this counter existed, so an install
   * upgrading mid-flight does not forget attempts it already made.
   */
  getRetryCount(taskId: string): number {
    const fromRing = this.history.filter(
      (h) => h.taskId === taskId && h.command === 'task' && h.status !== 'completed',
    ).length;
    return Math.max(this.retryCounts[taskId] ?? 0, fromRing);
  }

  // ─── Status Updates ────────────────────────────────────────────────────────

  setLastPollAt(timestamp: string): void {
    this.lastPollAt = timestamp;
  }

  setNextScheduledRun(command: string, nextRun: string): void {
    this.nextScheduledRuns[command] = nextRun;
  }

  updateUptime(): void {
    const startTime = new Date(this.startedAt).getTime();
    this.stats.uptimeMinutes = Math.round((Date.now() - startTime) / 60_000);
  }

  // ─── Stale Session Cleanup ─────────────────────────────────────────────────

  /**
   * Check all active sessions and mark any with dead PIDs as failed.
   * Called periodically (every minute) to proactively free up concurrency slots
   * instead of waiting for a GET request to /api/runs.
   */
  cleanStaleSessions(): void {
    for (const [id, session] of this.activeSessions) {
      // Skip sessions with PID 0 (just started, PID not yet assigned)
      if (session.pid <= 0) continue;

      if (isProcessRunning(session.pid)) {
        this.suspectedDead.delete(id);
        continue;
      }

      // One sweep's grace (E23). A child that has just exited normally is about
      // to be settled by its own `exit` handler with its real outcome; writing
      // a "process died" failure row first is how one session got double-ended
      // — a failed row AND a success transition — over a race of milliseconds.
      if (!this.suspectedDead.has(id)) {
        this.suspectedDead.add(id);
        logger.debug(
          'health',
          `Session ${id} (PID ${session.pid}) looks dead — confirming on the next sweep`,
        );
        continue;
      }

      logger.warn(
        'health',
        `Stale session detected: ${id} (PID ${session.pid} is dead) — marking as failed`,
      );
      this.endSession(id, 1, 'Process died unexpectedly (detected by health check)', false);
    }
  }

  // ─── Persistence ──────────────────────────────────────────────────────────

  private loadPersistedStats(): void {
    try {
      if (!existsSync(STATUS_FILE)) return;
      const raw = readFileSync(STATUS_FILE, 'utf-8');
      const data = JSON.parse(raw) as DaemonStatus;
      // Carry over cumulative stats from previous run
      if (data.stats) {
        this.stats.tasksDispatched = data.stats.tasksDispatched || 0;
        this.stats.tasksCompleted = data.stats.tasksCompleted || 0;
        this.stats.tasksFailed = data.stats.tasksFailed || 0;
      }
      if (data.history) {
        this.history = data.history.slice(0, MAX_HISTORY);
      }
      // A daemon restart must not reset the retry budget — that would be E4 in
      // a different disguise.
      if (data.retryCounts && typeof data.retryCounts === 'object') {
        for (const [taskId, count] of Object.entries(data.retryCounts)) {
          if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
            this.retryCounts[taskId] = count;
          }
        }
      }
    } catch {
      // Fresh start if status file is corrupted
    }
  }

  getStatus(): DaemonStatus {
    this.updateUptime();
    return {
      status: 'running',
      pid: process.pid,
      startedAt: this.startedAt,
      activeSessions: this.getActiveSessions(),
      history: this.history,
      retryCounts: { ...this.retryCounts },
      stats: { ...this.stats },
      lastPollAt: this.lastPollAt,
      nextScheduledRuns: { ...this.nextScheduledRuns },
      governor: governorStatus(),
    };
  }

  /**
   * Persist status to disk using atomic write (write tmp → rename).
   * This prevents corruption if the daemon is killed mid-write.
   */
  flush(): void {
    try {
      const status = this.getStatus();
      const tmp = `${STATUS_FILE}.tmp`;
      writeFileSync(tmp, JSON.stringify(status, null, 2), 'utf-8');
      renameSync(tmp, STATUS_FILE);
    } catch (err) {
      logger.error(
        'health',
        `Failed to write status file: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Write a stopped status when the daemon shuts down.
   * Uses atomic write (write tmp → rename).
   */
  writeStoppedStatus(): void {
    this.updateUptime();
    const status: DaemonStatus = {
      status: 'stopped',
      pid: null,
      startedAt: null,
      activeSessions: [],
      history: this.history,
      retryCounts: { ...this.retryCounts },
      stats: { ...this.stats },
      lastPollAt: this.lastPollAt,
      nextScheduledRuns: {},
      governor: governorStatus(),
    };
    try {
      const tmp = `${STATUS_FILE}.tmp`;
      writeFileSync(tmp, JSON.stringify(status, null, 2), 'utf-8');
      renameSync(tmp, STATUS_FILE);
    } catch {
      // Best effort
    }
  }
}
