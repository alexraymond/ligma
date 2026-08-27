#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../paths';
import { type DaemonServer, startHttpServer } from '../server';
import { loadConfig } from './config';
import { readPidFile, removePidFile, startEngine, stopEngine } from './lifecycle';
import { logger } from './logger';
import { AgentRunner } from './runner';
import type { DaemonConfig } from './types';

const STATUS_FILE = path.join(DATA_DIR, 'daemon-status.json');

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 = check if process exists
    return true;
  } catch {
    return false;
  }
}

function backendsToProbe(config: DaemonConfig): Array<'claude' | 'codex' | 'gemini'> {
  const set = new Set<'claude' | 'codex' | 'gemini'>();
  const mode = config.execution.backendMode;

  if (mode === 'mixed') {
    set.add('claude');
    set.add('codex');
    set.add('gemini');
  } else if (mode === 'claude') {
    set.add('claude');
    if (config.execution.claudeAutoFailoverEnabled) {
      // Multi-stage fallback for claude can use both secondary providers.
      set.add('codex');
      set.add('gemini');
    }
  } else if (mode === 'codex') {
    set.add('codex');
    set.add('gemini'); // codex fallback target
  } else if (mode === 'gemini') {
    set.add('gemini');
    set.add('codex'); // gemini fallback target
  }

  return Array.from(set);
}

function logBackendHealth(config: DaemonConfig): void {
  const toProbe = backendsToProbe(config);
  logger.info('daemon', `Backend health check (${toProbe.join(', ')})`);

  for (const backend of toProbe) {
    const result = AgentRunner.probeBackend(backend);
    if (result.available) {
      logger.info('daemon', `Backend ${backend}: available (${result.path})`);
    } else {
      logger.warn(
        'daemon',
        `Backend ${backend}: unavailable (${result.path})${result.message ? ` — ${result.message}` : ''}`,
      );
    }
  }
}

// ─── Commands ────────────────────────────────────────────────────────────────

/**
 * Print status AND say it in an exit code (P21).
 *
 * `status` exited 0 whether the daemon was up or down, so a script could only
 * tell by parsing ANSI-coloured prose. LSB convention: 0 = running, 3 = stopped.
 */
function handleStatus(): void {
  const pid = readPidFile();
  if (pid && isProcessRunning(pid)) {
    try {
      const status = JSON.parse(readFileSync(STATUS_FILE, 'utf-8'));
      console.log('\n=== Ligma Agent Daemon ===');
      console.log('Status:  \x1b[32mRunning\x1b[0m');
      console.log(`PID:     ${pid}`);
      console.log(`Started: ${status.startedAt || 'unknown'}`);
      console.log(`Uptime:  ${status.stats?.uptimeMinutes || 0} minutes`);
      console.log(`Active:  ${status.activeSessions?.length || 0} session(s)`);
      console.log(
        `Stats:   ${status.stats?.tasksCompleted || 0} completed, ${status.stats?.tasksFailed || 0} failed`,
      );
      console.log(`Last:    ${status.lastPollAt || 'never polled'}`);
      console.log('');
    } catch {
      console.log(`\nDaemon is running (PID: ${pid}) but status file is unreadable.\n`);
    }
  } else {
    if (pid) removePidFile(); // Clean stale PID file
    console.log('\n=== Ligma Agent Daemon ===');
    console.log('Status:  \x1b[31mStopped\x1b[0m');
    console.log('');
    process.exit(3);
  }
}

/** Exit 3 when there was nothing to stop, for the same reason `status` does. */
function handleStop(): void {
  const pid = readPidFile();
  if (!pid) {
    console.log('Daemon is not running (no PID file).');
    process.exit(3);
  }

  if (!isProcessRunning(pid)) {
    console.log('Daemon is not running (stale PID file). Cleaning up.');
    removePidFile();
    process.exit(3);
  }

  console.log(`Stopping daemon (PID: ${pid})...`);
  try {
    process.kill(pid, 'SIGTERM');
    console.log('Stop signal sent. Daemon will shut down gracefully.');
  } catch (err) {
    console.error(`Failed to stop daemon: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

async function handleStart(): Promise<void> {
  // Check for existing instance
  const existingPid = readPidFile();
  if (existingPid && isProcessRunning(existingPid)) {
    console.error(`Daemon is already running (PID: ${existingPid}). Use "stop" first.`);
    process.exit(1);
  }

  // Clean stale PID file
  if (existingPid) removePidFile();

  console.log('\n=== Ligma Agent Daemon ===\n');

  logBackendHealth(loadConfig());

  // The API and the dispatcher loop are one process: every face (web, cli)
  // talks to the same in-memory locks and the same JSON stores. The API comes
  // up first and stays up — POST /api/daemon stops and starts the loop under
  // it, which is what "stop the daemon" has always meant to the UI.
  let api: DaemonServer | null = null;
  try {
    api = await startHttpServer();
    logger.info('daemon', `API listening on http://127.0.0.1:${api.port}`);
  } catch (err) {
    logger.error(
      'daemon',
      `API failed to start: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  await startEngine();

  logger.info('daemon', 'Daemon is running. Press Ctrl+C to stop.');

  // ─── Graceful Shutdown ──────────────────────────────────────────────────

  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    await stopEngine(`Received ${signal}`);

    // Stop serving last: the status it reports stays true until the end
    if (api) await api.close();

    process.exit(0);
  }

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

// ─── CLI Entry Point ─────────────────────────────────────────────────────────

const command = process.argv[2] || 'start';

switch (command) {
  case 'start':
    handleStart().catch((err) => {
      logger.error('daemon', `Fatal error: ${err instanceof Error ? err.message : String(err)}`);
      removePidFile();
      process.exit(1);
    });
    break;

  case 'stop':
    handleStop();
    break;

  case 'status':
    handleStatus();
    break;

  default:
    console.log('Usage: npx tsx src/engine/index.ts [start|stop|status]');
    console.log('');
    console.log('Commands:');
    console.log('  start   Start the daemon (default)');
    console.log('  stop    Stop a running daemon');
    console.log('  status  Show daemon status');
    process.exit(1);
}
