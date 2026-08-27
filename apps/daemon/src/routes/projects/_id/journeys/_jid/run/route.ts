/**
 * POST /api/projects/:id/journeys/:jid/run — "Prove it".
 *
 * Spawns the journey runner detached, exactly as the task runner is spawned, so
 * the run streams and is watchable like any other run. The 202 carries the pid;
 * the run itself appears under /api/verification-runs.
 */

import { spawnJourneyRun } from '../../../../../../harness/verdict';
import { NextResponse } from '../../../../../../http';
import { readBoot, readJourney } from '../../../../../../store/ligma-dir';
import { requireRepo } from '../../../_lib';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; jid: string }> },
) {
  const { id, jid } = await params;
  const repo = await requireRepo(id);
  if (!repo.ok) return repo.response;

  if (!readJourney(repo.repoPath, jid)) {
    return NextResponse.json({ error: 'Journey not found' }, { status: 404 });
  }

  // Fail here, not four minutes into an install: a missing or malformed boot
  // recipe is a fact we already know.
  const boot = readBoot(repo.repoPath);
  if (boot.status !== 'ready') {
    return NextResponse.json(
      {
        error: boot.error ?? `${repo.repoPath}/.ligma/boot.json is missing`,
        bootStatus: boot.status,
      },
      { status: 409 },
    );
  }

  const smoke = new URL(request.url).searchParams.get('smoke') === 'true';
  // The same spawn the scheduler's smoke firings use — one place, so a manual
  // "Prove it" and a scheduled one cannot behave differently.
  const child = spawnJourneyRun(id, jid, { smoke, detached: true });
  child.unref();

  return NextResponse.json(
    { projectId: id, journeyId: jid, pid: child.pid ?? 0, message: `Journey ${jid} run started` },
    { status: 202 },
  );
}
