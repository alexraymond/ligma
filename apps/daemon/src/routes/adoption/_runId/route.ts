/**
 * GET /api/adoption/:runId — the adoption run and its review sheet: the
 * inferred boot recipe with its rationale, the proposed journeys, and the
 * exploratory agent's confusion log (the project's first UX audit).
 */

import { draftBootFromFacts, getAdoptionRun, readRepoFacts } from '../../../engine/adopt-repo';
import { NextResponse } from '../../../http';

/**
 * What the correction editor pre-fills when the run failed before inference
 * produced a recipe: the appDir and install the repo's own facts already prove.
 * Derived per request, never stored — the facts are on disk either way.
 */
function bootDraft(repoPath: string) {
  try {
    return draftBootFromFacts(readRepoFacts(repoPath));
  } catch {
    return null;
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  try {
    const run = getAdoptionRun(runId);
    if (!run) return NextResponse.json({ error: 'Adoption run not found' }, { status: 404 });
    return NextResponse.json({ ...run, bootDraft: run.boot ?? bootDraft(run.repoPath) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
