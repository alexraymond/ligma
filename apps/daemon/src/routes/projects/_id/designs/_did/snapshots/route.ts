/**
 * GET/POST /api/projects/:id/designs/:did/snapshots — the version rail.
 *
 * POST restores. It never mutates history: the restore appends a new version
 * pointing at the old content, so the state you restored away from stays on the
 * rail. That is the difference between a version rail and an undo button, and
 * F4 asks for the former ("an iteration tool without memory is half a tool").
 */

import { NextResponse } from '../../../../../../http';
import { isTurnInFlight } from '../../../../../../studio/session';
import { mutateManifest, toSnapshotSummary } from '../../../../../../studio/store';
import { restoreVersion } from '../../../../../../studio/store';
import { badRequest, jsonBody, requireDesign } from '../../_lib';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; did: string }> },
) {
  const { id, did } = await params;
  const found = await requireDesign(id, did);
  if (!found.ok) return found.response;
  return NextResponse.json({
    designId: did,
    snapshots: found.manifest.versions.map(toSnapshotSummary),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; did: string }> },
) {
  const { id, did } = await params;
  const found = await requireDesign(id, did);
  if (!found.ok) return found.response;

  // Restoring under a running turn would race the generator's own writes.
  if (isTurnInFlight(did)) {
    return NextResponse.json(
      { error: 'A turn is in flight — stop it before restoring' },
      { status: 409 },
    );
  }

  try {
    const body = await jsonBody(request);
    if (typeof body.versionId !== 'string') throw new Error('`versionId` is required');
    const version = await mutateManifest(id, did, (manifest) =>
      restoreVersion(manifest, body.versionId as string),
    );
    return NextResponse.json(
      { designId: did, snapshot: toSnapshotSummary(version) },
      { status: 201 },
    );
  } catch (err) {
    return badRequest(err);
  }
}
