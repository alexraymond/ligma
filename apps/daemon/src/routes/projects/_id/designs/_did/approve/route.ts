/**
 * POST /api/projects/:id/designs/:did/approve — freeze the design.
 *
 * Approval is what turns a design into an oracle (merger spec: "the approved
 * prototype becomes the frozen acceptance contract"), so it is a human act and
 * it pins a specific version. Not "latest" — latest keeps moving, and an oracle
 * that moves is not one.
 */

import type { DesignApproveResult } from '@ligma/api';
import { NextResponse } from '../../../../../../http';
import { isTurnInFlight } from '../../../../../../studio/session';
import { latestVersion, mutateManifest, setStatus } from '../../../../../../studio/store';
import { badRequest, requireDesign } from '../../_lib';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; did: string }> },
) {
  const { id, did } = await params;
  const found = await requireDesign(id, did);
  if (!found.ok) return found.response;

  if (isTurnInFlight(did)) {
    return NextResponse.json(
      { error: 'A turn is in flight — approving now would freeze a half-written design' },
      { status: 409 },
    );
  }

  try {
    const result = await mutateManifest(id, did, (manifest): DesignApproveResult => {
      const version = latestVersion(manifest);
      if (!version) throw new Error('Nothing to approve — this design has no versions yet');
      setStatus(manifest, 'approved');
      return {
        designId: manifest.id,
        status: manifest.status,
        approvedAt: manifest.approvedAt ?? manifest.updatedAt,
        baseline: {
          designId: manifest.id,
          versionId: version.id,
          approvedAt: manifest.approvedAt ?? manifest.updatedAt,
          designSystem: manifest.designSystem,
          files: version.files,
        },
      };
    });
    return NextResponse.json(result);
  } catch (err) {
    return badRequest(err);
  }
}
