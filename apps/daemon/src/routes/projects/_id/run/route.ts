import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { NextResponse } from '../../../../http';
import { DAEMON_ROOT, ENGINE_DIR } from '../../../../paths';

import { DATA_DIR } from '../../../../paths';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readJSON<T>(file: string): T | null {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

interface TaskEntry {
  id: string;
  assignedTo: string | null;
  kanban: string;
  projectId: string | null;
}

interface RunEntry {
  id: string;
  taskId: string;
  status: string;
}

// ─── POST: Run all eligible tasks in a project ──────────────────────────────

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;

  // 1. Load tasks
  const tasksData = readJSON<{ tasks: TaskEntry[] }>(path.join(DATA_DIR, 'tasks.json'));
  if (!tasksData) {
    return NextResponse.json({ error: 'Could not read tasks' }, { status: 500 });
  }

  // 2. Find eligible project tasks (not done, has agent assigned)
  const eligible = tasksData.tasks.filter(
    (t) =>
      t.projectId === projectId && t.kanban !== 'done' && t.assignedTo && t.assignedTo !== 'me',
  );

  if (eligible.length === 0) {
    return NextResponse.json(
      { error: 'No eligible tasks to run in this project' },
      { status: 400 },
    );
  }

  // 3. Check which tasks are already running
  const runsData = readJSON<{ runs: RunEntry[] }>(path.join(DATA_DIR, 'active-runs.json'));
  const runningTaskIds = new Set(
    (runsData?.runs ?? []).filter((r) => r.status === 'running').map((r) => r.taskId),
  );

  const toRun = eligible.filter((t) => !runningTaskIds.has(t.id));
  const skipped = eligible.filter((t) => runningTaskIds.has(t.id));

  // 4. Load daemon config for concurrency + agentTeams
  const configData = readJSON<{
    concurrency: { maxParallelAgents: number };
    execution: { agentTeams?: boolean };
  }>(path.join(DATA_DIR, 'daemon-config.json'));

  const maxParallel = configData?.concurrency?.maxParallelAgents ?? 3;
  const agentTeams = configData?.execution?.agentTeams ?? false;

  // 5. Respect concurrency limit (total running + new launches)
  const currentlyRunning = runningTaskIds.size;
  const slotsAvailable = Math.max(0, maxParallel - currentlyRunning);
  const tasksToLaunch = toRun.slice(0, slotsAvailable);
  const queued = toRun.slice(slotsAvailable);

  // 6. Spawn run-task.ts for each task
  const cwd = DAEMON_ROOT;
  const scriptPath = path.join(ENGINE_DIR, 'run-task.ts');
  const launched: string[] = [];

  for (const task of tasksToLaunch) {
    const args = ['--import', 'tsx', scriptPath, task.id, '--source', 'project-run'];
    if (agentTeams) {
      args.push('--agent-teams');
    }

    try {
      const child = spawn(process.execPath, args, {
        cwd,
        detached: true,
        stdio: 'ignore',
        shell: false,
      });
      child.unref();
      launched.push(task.id);
    } catch {
      // Skip this task on spawn failure — others may still succeed
    }
  }

  return NextResponse.json({
    projectId,
    launched,
    skipped: skipped.map((t) => t.id),
    queued: queued.map((t) => t.id),
    total: eligible.length,
  });
}
