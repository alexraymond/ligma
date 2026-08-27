/**
 * GET /api/runs/:id/changes — what this run left behind.
 *
 * `{commitSha, capturedAt, stat, diff}`, and every one of them may be null.
 * Absent is not empty: a null `diff` means nothing was captured (the cwd was not
 * a repo, or the capture failed), while `""` means the run genuinely changed
 * nothing. Collapsing the two would turn "we don't know" into "it did nothing",
 * which is the exact claim the Verify surface must never make on its own.
 *
 * 404 only when the run id is unknown EVERYWHERE — no row in active-runs.json
 * and no artifact on disk. A known run with nothing captured is a 200 full of
 * nulls, because the honest answer to "what did it change?" is "no record", not
 * "no such run".
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { type RunChanges, runOutputsDir } from '../../../../engine/run-changes';
import { NextResponse } from '../../../../http';
import { DATA_DIR } from '../../../../paths';

const ACTIVE_RUNS_FILE = path.join(DATA_DIR, 'active-runs.json');

/** The run row, or null. A missing/corrupt store is "unknown", never a throw. */
function findRun(runId: string): { commitSha?: string | null } | null {
  try {
    if (!existsSync(ACTIVE_RUNS_FILE)) return null;
    const data = JSON.parse(readFileSync(ACTIVE_RUNS_FILE, 'utf-8')) as {
      runs?: Array<{ id?: string; commitSha?: string | null }>;
    };
    return data.runs?.find((r) => r.id === runId) ?? null;
  } catch {
    return null;
  }
}

function readChanges(safeId: string): RunChanges | null {
  const filePath = path.join(runOutputsDir(), `${safeId}.changes.json`);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as RunChanges;
  } catch {
    // A half-written capture is no capture. Falls through to the null answer.
    return null;
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_');

  const changes = readChanges(safeId);
  const run = findRun(id);
  // Nothing anywhere knows this id. The output file is the third witness: a run
  // pruned out of active-runs.json can still have left evidence behind.
  if (!changes && !run && !existsSync(path.join(runOutputsDir(), `${safeId}.jsonl`))) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  return NextResponse.json({
    // The run row's sha is the fallback: it is recorded at spawn, so a run whose
    // capture never happened still knows which commit it started from.
    commitSha: changes?.commitSha ?? run?.commitSha ?? null,
    capturedAt: changes?.capturedAt ?? null,
    stat: changes?.stat ?? null,
    diff: changes?.diff ?? null,
    // Extra keys beyond the pinned four — additive, and a client that ignores
    // them is unaffected. `truncated` matters: a capped diff that did not say so
    // would read as a complete one.
    status: changes?.status ?? null,
    truncated: changes?.truncated ?? false,
  });
}
