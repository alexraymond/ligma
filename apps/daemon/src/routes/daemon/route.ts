import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { startEngine, stopEngine } from '../../engine/lifecycle';
import { NextResponse } from '../../http';
import { getDaemonConfig, mutateDaemonConfig } from '../../store/data';
import { daemonConfigUpdateSchema, validateBody } from '../../store/validations';

import { DATA_DIR } from '../../paths';
const STATUS_FILE = path.join(DATA_DIR, 'daemon-status.json');
const PID_FILE = path.join(DATA_DIR, 'daemon.pid');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readJSON(file: string): unknown {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getPid(): number | null {
  try {
    if (!existsSync(PID_FILE)) return null;
    const pid = Number.parseInt(readFileSync(PID_FILE, 'utf-8').trim());
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

// ─── GET: Read daemon status + config ────────────────────────────────────────

export async function GET() {
  const status = readJSON(STATUS_FILE) ?? {
    status: 'stopped',
    pid: null,
    startedAt: null,
    activeSessions: [],
    history: [],
    stats: { tasksDispatched: 0, tasksCompleted: 0, tasksFailed: 0, uptimeMinutes: 0 },
    lastPollAt: null,
    nextScheduledRuns: {},
  };
  const config = await getDaemonConfig();

  // Verify daemon is actually running (PID check)
  const pid = getPid();
  const isRunning = pid !== null && isProcessRunning(pid);
  const statusObj = status as Record<string, unknown>;

  if (!isRunning && statusObj.status === 'running') {
    // Daemon crashed — update status
    statusObj.status = 'stopped';
    statusObj.pid = null;
  }

  return NextResponse.json({
    status: statusObj,
    config,
    isRunning,
  });
}

// ─── POST: Start/stop daemon ─────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { action?: string };
    const action = body.action;

    if (action === 'start') {
      const pid = getPid();
      if (pid && isProcessRunning(pid)) {
        return NextResponse.json(
          { error: `Daemon is already running (PID: ${pid})` },
          { status: 409 },
        );
      }

      // The loop starts inside this process — the API is already here, and the
      // two share the store's in-memory locks. No respawn, so no second
      // dispatcher can appear over the same JSON files.
      await startEngine();

      return NextResponse.json({ message: 'Daemon starting...', pid: process.pid });
    }

    if (action === 'stop') {
      const pid = getPid();
      if (!pid || !isProcessRunning(pid)) {
        return NextResponse.json({ message: 'Daemon is not running' });
      }

      try {
        if (pid === process.pid) {
          // Stop dispatching, keep serving. "Stop the daemon" never meant "take
          // the UI's API down with it", and this is the same process now.
          await stopEngine('Stop requested via API');
        } else {
          // An engine in another process (a separate `daemon:start`) — the only
          // handle on it is still a signal.
          process.kill(pid, 'SIGTERM');
        }
        return NextResponse.json({ message: 'Stop signal sent', pid });
      } catch (err) {
        return NextResponse.json(
          { error: `Failed to stop daemon: ${err instanceof Error ? err.message : String(err)}` },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ error: "Invalid action. Use 'start' or 'stop'" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid request: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 },
    );
  }
}

// ─── PUT: Update daemon config ───────────────────────────────────────────────

export async function PUT(request: Request) {
  // Validate request body against Zod schema
  const validation = await validateBody(request, daemonConfigUpdateSchema);
  if (!validation.success) return validation.error;
  const updates = validation.data;

  // SECURITY: Reject attempts to enable skipPermissions via API.
  // This can only be set by manually editing data/daemon-config.json.
  if (updates.execution?.skipPermissions === true) {
    return NextResponse.json(
      {
        error: 'Cannot enable skipPermissions via API',
        details:
          'skipPermissions can only be set by manually editing data/daemon-config.json. This is a safety measure to prevent remote escalation.',
      },
      { status: 403 },
    );
  }

  // Atomic read-modify-write with mutex
  const newConfig = await mutateDaemonConfig(async (currentConfig) => {
    // Section-level merge: replace entire sections, not individual fields.
    // execution is the exception — it's merged field-by-field so an update that
    // doesn't mention harness/governor (e.g. a client unaware of them) can't
    // silently delete those sub-blocks (belt-and-braces alongside the client fix).
    if (updates.polling) currentConfig.polling = updates.polling;
    if (updates.concurrency) currentConfig.concurrency = updates.concurrency;
    if (updates.schedule) currentConfig.schedule = updates.schedule;
    if (updates.storage) currentConfig.storage = updates.storage;
    if (updates.notifications) currentConfig.notifications = updates.notifications;
    if (updates.execution) {
      const existingExecution = (currentConfig.execution ?? {}) as Record<string, unknown>;
      currentConfig.execution = { ...existingExecution, ...updates.execution };
    }
    return { ...currentConfig };
  });

  return NextResponse.json({ message: 'Config updated', config: newConfig });
}
