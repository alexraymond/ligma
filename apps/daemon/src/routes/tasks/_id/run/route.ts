import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pendingDecisionBlock } from '../../../../engine/prompt-builder';
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
  blockedBy?: string[];
}

interface RunEntry {
  id: string;
  taskId: string;
  status: string;
}

// ─── POST: Run a single task ─────────────────────────────────────────────────

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: taskId } = await params;

  // 1. Validate task exists
  const tasksData = readJSON<{ tasks: TaskEntry[] }>(path.join(DATA_DIR, 'tasks.json'));
  if (!tasksData) {
    return NextResponse.json({ error: 'Could not read tasks' }, { status: 500 });
  }

  const task = tasksData.tasks.find((t) => t.id === taskId);
  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  // 2. Validate task has an AI agent assigned
  if (!task.assignedTo || task.assignedTo === 'me') {
    return NextResponse.json({ error: 'Task has no AI agent assigned' }, { status: 400 });
  }

  // 3. Validate task is not already done or awaiting verification.
  // Mirrors scripts/daemon/run-task.ts's own precondition — run-task.ts exits 1
  // immediately for an awaiting-verification task, so letting this route spawn
  // it anyway just returns a false-positive 200 while the child dies right away.
  if (task.kanban === 'done') {
    return NextResponse.json({ error: 'Task is already done' }, { status: 400 });
  }
  if (task.kanban === 'awaiting-verification') {
    return NextResponse.json(
      { error: 'Task is awaiting verification — the acceptance harness owns it, not the builder' },
      { status: 400 },
    );
  }

  // 4. Check not already running
  const runsData = readJSON<{ runs: RunEntry[] }>(path.join(DATA_DIR, 'active-runs.json'));
  if (runsData) {
    const alreadyRunning = runsData.runs.find((r) => r.taskId === taskId && r.status === 'running');
    if (alreadyRunning) {
      return NextResponse.json({ error: 'Task is already running' }, { status: 409 });
    }
  }

  // 5. Check if task is blocked by unfinished dependencies
  if (task.blockedBy && task.blockedBy.length > 0) {
    const stillBlocked = task.blockedBy.some((depId) => {
      const dep = tasksData.tasks.find((t) => t.id === depId);
      return !dep || dep.kanban !== 'done';
    });
    if (stillBlocked) {
      return NextResponse.json(
        { error: 'Task is blocked by unfinished dependencies' },
        { status: 400 },
      );
    }
  }

  // 6. The park rule — the daemon's, not a second opinion.
  //
  // This route used to mirror only half of it (any pending blocksTask-true
  // decision) and miss the other half entirely (the ≥3-unanswered-decisions
  // park), so the daemon skipped a task while the Run button happily started it
  // — the two disagreeing about the same task, which is exactly the state
  // execution-flow-review H4 names. It now calls the same function the dispatch
  // filter calls, so there is one rule with one wording.
  const park = pendingDecisionBlock(taskId);
  if (park) {
    return NextResponse.json(
      {
        error: `Not started — ${park.reason}`,
        parkedReason: park.reason,
        pendingDecisions: park.pending,
      },
      { status: 409 },
    );
  }

  // 7. Load daemon config for agentTeams flag
  const configData = readJSON<{
    execution: { agentTeams?: boolean };
  }>(path.join(DATA_DIR, 'daemon-config.json'));
  const agentTeams = configData?.execution?.agentTeams ?? false;

  // 8. Spawn run-task.ts as detached process
  const cwd = DAEMON_ROOT;
  const scriptPath = path.join(ENGINE_DIR, 'run-task.ts');

  const args = ['--import', 'tsx', scriptPath, taskId, '--source', 'manual'];
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

    return NextResponse.json({
      taskId,
      pid: child.pid ?? 0,
      message: `Task ${taskId} execution started`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to spawn: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
