/**
 * DELETE /api/references/:id/design-files/:fileId
 */

import { NextResponse } from '../../../../../http';
import { badRequest, findProject } from '../../../../projects/_id/_lib';
import { mutateWorkspace } from '../../../store';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const { id, fileId } = await params;
  try {
    if (!(await findProject(id)))
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    const removed = await mutateWorkspace(id, (data) => {
      const before = data.designFiles.length;
      data.designFiles = data.designFiles.filter((f) => f.id !== fileId);
      return data.designFiles.length !== before;
    });

    if (!removed) return NextResponse.json({ error: 'Design file not found' }, { status: 404 });
    return NextResponse.json({ projectId: id, fileId });
  } catch (err) {
    return badRequest(err);
  }
}
