/**
 * POST /api/adoption/:runId/retry {boot?} — go again on an adoption run that
 * failed (UX spec F2 recovery).
 *
 * A failed adoption used to be a dead end: no retry, no log, and the only way
 * to correct the boot recipe was the review sheet, which a run that never
 * reached `awaiting-review` never shows. This is that correction, moved to
 * where the failure is — the same `boot` schema the review sheet POSTs, pinned
 * onto the run so the worker boots from it instead of inferring again.
 *
 * Nothing is written into the target repo here; that is still the review call.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { z } from 'zod';
import { retryAdoption } from '../../../../engine/adopt-repo';
import { NextResponse } from '../../../../http';
import { DAEMON_ROOT, ENGINE_DIR } from '../../../../paths';
import { bootRecipeSchema } from '../../../../store/ligma-dir';
import { validateBody } from '../../../../store/validations';

const retrySchema = z.object({ boot: bootRecipeSchema.optional() });

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const validation = await validateBody(request, retrySchema);
  if (!validation.success) return validation.error;

  let run: ReturnType<typeof retryAdoption>;
  try {
    run = retryAdoption(runId, validation.data.boot);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  const child = spawn(
    process.execPath,
    ['--import', 'tsx', path.join(ENGINE_DIR, 'adopt-repo.ts'), run.id],
    {
      cwd: DAEMON_ROOT,
      detached: true,
      stdio: 'ignore',
      shell: false,
    },
  );
  child.unref();

  return NextResponse.json({ ...run, pid: child.pid ?? 0 }, { status: 202 });
}
