/**
 * GET/POST /api/projects/:id/journeys — journeys read and write through
 * `<repoPath>/.ligma/journeys/`, never a central store. Journeys are the
 * visible slice on purpose (twin-primitives §3): they travel with the code and
 * the builder is allowed to read them. Baselines are the half that stays hidden.
 */

import type { JourneyWithStatus } from '@ligma/api';
import { journeyStatuses } from '../../../../engine/smoke';
import { NextResponse } from '../../../../http';
import { journeyInputSchema, listJourneys, writeJourney } from '../../../../store/ligma-dir';
import { validateBody } from '../../../../store/validations';
import { badRequest, requireRepo } from '../_lib';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repo = await requireRepo(id);
  if (!repo.ok) return repo.response;

  const { journeys, invalid } = listJourneys(repo.repoPath);

  // Staleness (UX spec §6 Verify): journeys live in the repo, verdicts live
  // centrally, and nothing joined them — so a health board had to fetch every
  // run and then every verdict to answer "when was this last proven?".
  const statuses = journeyStatuses(id);
  const withStatus: JourneyWithStatus[] = journeys.map((journey) => ({
    ...journey,
    lastRunAt: null,
    lastVerdictAt: null,
    lastOutcome: null,
    lastRunId: null,
    ...statuses.get(journey.id),
  }));

  return NextResponse.json({
    projectId: id,
    repoPath: repo.repoPath,
    journeys: withStatus,
    invalidJourneys: invalid,
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repo = await requireRepo(id);
  if (!repo.ok) return repo.response;

  const validation = await validateBody(request, journeyInputSchema);
  if (!validation.success) return validation.error;

  try {
    return NextResponse.json(writeJourney(repo.repoPath, validation.data), { status: 201 });
  } catch (err) {
    return badRequest(err);
  }
}
