/**
 * GET /api/projects/:id/designs/:did/files[?versionId=] — the design's bodies.
 *
 * `DesignVersion.files[]` lists paths, fingerprints and sizes; this is what
 * turns that listing into something an iframe can render. Bodies are read out
 * of the content-addressed blob store rather than off the working tree, which
 * buys three things for free:
 *
 *  - one code path for head and for history, so the version rail's before/after
 *    compares two immutable snapshots instead of "a snapshot vs whatever is on
 *    disk right now";
 *  - path safety by construction — every path in the response came out of the
 *    manifest, and every body was addressed by a validated SHA-256 fingerprint,
 *    so no caller-supplied string ever reaches the filesystem;
 *  - a served version that always matches the version it claims to be.
 *
 * ponytail: mid-turn writes are deliberately not served. Until a turn records
 * its snapshot the head version is the previous one, so a half-written file
 * never reaches an iframe — the Wall's live view is the SSE file-progress
 * stream, not this route. If progressive bodies are ever wanted, add
 * `?live=true` reading the source tree; do not blur the two here.
 */

import type { DesignFilesResponse } from '@ligma/api';
import { type NextRequest, NextResponse } from '../../../../../../http';
import { blobsDir } from '../../../../../../studio/paths';
import { readSnapshotBodies } from '../../../../../../studio/snapshots';
import { findVersion, latestVersion } from '../../../../../../studio/store';
import { requireDesign } from '../../_lib';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; did: string }> },
) {
  const { id, did } = await params;
  const found = await requireDesign(id, did);
  if (!found.ok) return found.response;

  const { manifest } = found;
  const requested = request.nextUrl.searchParams.get('versionId');
  const version = requested ? findVersion(manifest, requested) : latestVersion(manifest);

  // An unknown versionId is a 404, not an empty list: silently serving the head
  // for a version that does not exist would make a before/after compare lie.
  if (requested && !version) {
    return NextResponse.json({ error: `Version not found: ${requested}` }, { status: 404 });
  }

  // A design with no versions yet is a legitimate empty answer — the session
  // exists, the first turn just has not landed.
  if (!version) {
    return NextResponse.json({
      designId: did,
      versionId: null,
      files: [],
    } satisfies DesignFilesResponse);
  }

  // A blob that will not read is a corrupt store, not a reason to fail the
  // whole design — `readSnapshotBodies` skips it, so the other screens still
  // render and the missing one shows as absent rather than taking the Wall
  // down. The export route reads through the same helper, so a design exports
  // exactly the bytes it renders.
  const files = await readSnapshotBodies(blobsDir(id, did), version.files);

  return NextResponse.json({
    designId: did,
    versionId: version.id,
    files,
  } satisfies DesignFilesResponse);
}
