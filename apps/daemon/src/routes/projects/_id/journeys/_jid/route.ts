/**
 * PATCH/DELETE /api/projects/:id/journeys/:jid — edit or remove one journey
 * file in the target repo. A PATCH merges onto what is on disk, so a rename
 * cannot silently drop the steps.
 */

import { NextResponse } from '../../../../../http';
import {
  deleteJourney,
  journeyPatchSchema,
  readJourney,
  writeJourney,
} from '../../../../../store/ligma-dir';
import { validateBody } from '../../../../../store/validations';
import { badRequest, requireRepo } from '../../_lib';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; jid: string }> },
) {
  const { id, jid } = await params;
  const repo = await requireRepo(id);
  if (!repo.ok) return repo.response;

  const journey = readJourney(repo.repoPath, jid);
  if (!journey) return NextResponse.json({ error: 'Journey not found' }, { status: 404 });
  return NextResponse.json(journey);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; jid: string }> },
) {
  const { id, jid } = await params;
  const repo = await requireRepo(id);
  if (!repo.ok) return repo.response;

  const existing = readJourney(repo.repoPath, jid);
  if (!existing) return NextResponse.json({ error: 'Journey not found' }, { status: 404 });

  const validation = await validateBody(request, journeyPatchSchema);
  if (!validation.success) return validation.error;

  try {
    return NextResponse.json(
      writeJourney(repo.repoPath, { ...existing, ...validation.data, id: jid }),
    );
  } catch (err) {
    return badRequest(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; jid: string }> },
) {
  const { id, jid } = await params;
  const repo = await requireRepo(id);
  if (!repo.ok) return repo.response;

  try {
    if (!deleteJourney(repo.repoPath, jid)) {
      return NextResponse.json({ error: 'Journey not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, journeyId: jid });
  } catch (err) {
    return badRequest(err);
  }
}
