/**
 * DELETE /api/references/:id/:refId — remove one reference from the board.
 */

import { NextResponse } from '../../../../http';
import { badRequest, findProject } from '../../../projects/_id/_lib';
import { mutateWorkspace } from '../../store';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; refId: string }> },
) {
  const { id, refId } = await params;
  try {
    if (!(await findProject(id)))
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    const removed = await mutateWorkspace(id, (data) => {
      const before = data.references.length;
      data.references = data.references.filter((r) => r.id !== refId);
      return data.references.length !== before;
    });

    if (!removed) return NextResponse.json({ error: 'Reference not found' }, { status: 404 });
    return NextResponse.json({ projectId: id, refId });
  } catch (err) {
    return badRequest(err);
  }
}
