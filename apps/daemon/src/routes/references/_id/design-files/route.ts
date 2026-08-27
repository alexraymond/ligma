/**
 * GET/POST /api/references/:id/design-files — per-project uploaded design
 * files (OD-138), over the same store References uses (one JSON file, two
 * views — see `../../store.ts`'s docblock).
 *
 * No multipart handling exists anywhere in the daemon (grepped: none) — this
 * accepts a base64 `dataUrl` JSON payload with a size cap, same shape as the
 * References screenshot upload, honestly documented rather than reaching for
 * a multipart-parsing dependency this repo has never needed.
 */

import { z } from 'zod';
import { NextResponse } from '../../../../http';
import { badRequest, findProject } from '../../../projects/_id/_lib';
import { type DesignFileItem, mutateWorkspace, newWorkspaceId, readWorkspace } from '../../store';

const MAX_FILE_BYTES = 10_000_000;
const MAX_FILES = 200;

const DATA_URL = /^data:([a-zA-Z0-9.+/-]+);base64,([A-Za-z0-9+/=]+)$/;

const uploadSchema = z.object({
  name: z.string().min(1).max(255),
  dataUrl: z.string().min(1),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    if (!(await findProject(id)))
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    const { designFiles } = await readWorkspace(id);
    return NextResponse.json({ projectId: id, designFiles });
  } catch (err) {
    return badRequest(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    if (!(await findProject(id)))
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const parsed = uploadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
        { status: 400 },
      );
    }

    const match = DATA_URL.exec(parsed.data.dataUrl);
    if (!match) {
      return NextResponse.json(
        { error: 'dataUrl must be base64-encoded: data:<mime>;base64,<data>' },
        { status: 400 },
      );
    }
    const byteLength = Math.floor((match[2].length * 3) / 4);
    if (byteLength > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `File exceeds the ${Math.floor(MAX_FILE_BYTES / 1_000_000)}MB cap` },
        { status: 413 },
      );
    }

    const item: DesignFileItem = {
      id: newWorkspaceId('dfile'),
      name: parsed.data.name,
      mime: match[1],
      dataUrl: parsed.data.dataUrl,
      size: byteLength,
      createdAt: new Date().toISOString(),
    };

    const designFiles = await mutateWorkspace(id, (data) => {
      if (data.designFiles.length >= MAX_FILES) {
        throw new Error(
          `This project already has ${MAX_FILES} design files — delete one before adding another`,
        );
      }
      data.designFiles.push(item);
      return data.designFiles;
    });

    return NextResponse.json({ projectId: id, designFiles }, { status: 201 });
  } catch (err) {
    return badRequest(err);
  }
}
