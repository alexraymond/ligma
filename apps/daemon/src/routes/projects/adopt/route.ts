/**
 * POST /api/projects/adopt {repoPath} — start an adoption run (UX spec F2).
 *
 * Returns immediately with the run record; the worker is detached so the run is
 * watchable like any other. Nothing is written into the target repo until the
 * review sheet is answered.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { z } from 'zod';
import { createAdoptionRun, listAdoptionRuns } from '../../../engine/adopt-repo';
import { NextResponse } from '../../../http';
import { DAEMON_ROOT, ENGINE_DIR } from '../../../paths';
import { validateBody } from '../../../store/validations';

const adoptSchema = z.object({ repoPath: z.string().min(1).max(1000) });

export async function GET() {
  return NextResponse.json({ runs: listAdoptionRuns() });
}

export async function POST(request: Request) {
  const validation = await validateBody(request, adoptSchema);
  if (!validation.success) return validation.error;

  let run: ReturnType<typeof createAdoptionRun>;
  try {
    run = createAdoptionRun(validation.data.repoPath);
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
