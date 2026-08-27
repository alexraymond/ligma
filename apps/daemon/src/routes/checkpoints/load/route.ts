import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { isEngineRunning } from '../../../engine/lifecycle';
import { type NextRequest, NextResponse } from '../../../http';
import { DAEMON_ROOT } from '../../../paths';
import { getActiveRuns, getCheckpoint, loadCoreData } from '../../../store/data';
import { CHECKPOINT_SCOPE } from '../route';

const execAsync = promisify(exec);

/**
 * Whether a checkpoint restore must be refused right now, and why. Pure so the
 * decision table can be pinned in a test without spawning the engine or
 * touching disk — the handler wires it to the real reads below.
 *
 * `what` names the operation being refused. `checkpoints/new` shares this guard
 * for the same reason (it is a restore, mechanically) but it is a WIPE, and
 * telling someone about to erase their workspace that we are protecting them
 * from "restoring a checkpoint" describes the wrong thing to be careful about
 * (P2). Default keeps the restore caller's wording exactly as it was.
 */
export function restoreBlockedReason(
  engineRunning: boolean,
  runs: Array<{ status?: string }>,
  what = 'restoring a checkpoint',
): string | null {
  if (engineRunning) {
    return `Stop the daemon before ${what} — it would overwrite data out from under a running engine.`;
  }
  if (runs.some((r) => r.status === 'running')) {
    return `Wait for running work to finish before ${what} — a run is still in progress.`;
  }
  return null;
}

// POST /api/checkpoints/load — Load a checkpoint, replacing all current data
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { id?: string };
    const id = (body.id ?? '').trim();
    if (!id) {
      return NextResponse.json({ error: 'Checkpoint ID is required' }, { status: 400 });
    }
    // Validate ID format to prevent path traversal
    if (!/^snap_(\d+|demo)$/.test(id)) {
      return NextResponse.json({ error: 'Invalid checkpoint ID' }, { status: 400 });
    }

    const { runs } = await getActiveRuns();
    const blockedReason = restoreBlockedReason(isEngineRunning(), runs);
    if (blockedReason) {
      return NextResponse.json({ error: blockedReason }, { status: 409 });
    }

    const snap = await getCheckpoint(id);
    await loadCoreData(snap.data);

    // Regenerate AI context in background (don't block the response).
    // Invoked directly rather than through `pnpm gen:context`, whose script line
    // pins `LIGMA_DATA_DIR=../../data` — so a workspace on any other data dir
    // regenerated the wrong store's context. The child inherits ours.
    execAsync('pnpm exec tsx scripts/generate-context.ts', { cwd: DAEMON_ROOT }).catch(() => {
      // Silently ignore — context will be regenerated on next manual run
    });

    // The restore's partiality, said at the moment it matters — see P19.
    return NextResponse.json({ ok: true, name: snap.name, scope: CHECKPOINT_SCOPE });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to load checkpoint', details: String(err) },
      { status: 500 },
    );
  }
}
