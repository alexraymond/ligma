/**
 * GET/POST /api/references/:id/notes — the project's scratch-notes thread
 * (OD-134, "side-chat" v1).
 *
 * Honest scope call: this repo has no conversational machinery a lightweight
 * per-project scratch panel could sit on top of (grepped `inbox/respond` and
 * every chat-shaped route — `inbox` is task-delegation messaging between
 * agents, not free-form chat; there is no LLM-backed conversation engine at
 * all). Building one just to back a side panel would be the tab-registry
 * mistake's sibling: infrastructure nobody asked for, load-bearing for one
 * screen. So v1 is what it honestly is — an append-only, no-LLM thread: type
 * a note, it's saved, that's the whole feature. Notes are plain thread
 * entries with no `from`/`author` field because there is only ever one
 * writer; the shape upgrades to a real conversation (assistant turns, an
 * `author` field) the day this sits on an actual chat backend.
 */

import { z } from 'zod';
import { NextResponse } from '../../../../http';
import { badRequest, findProject } from '../../../projects/_id/_lib';
import { mutateWorkspace, newWorkspaceId, readWorkspace } from '../../store';

const MAX_NOTES = 2000;

const addNoteSchema = z.object({
  body: z.string().min(1).max(5000),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    if (!(await findProject(id)))
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    const { notes } = await readWorkspace(id);
    return NextResponse.json({ projectId: id, notes });
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
    const parsed = addNoteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
        { status: 400 },
      );
    }

    const note = {
      id: newWorkspaceId('note'),
      body: parsed.data.body,
      createdAt: new Date().toISOString(),
    };
    const notes = await mutateWorkspace(id, (data) => {
      if (data.notes.length >= MAX_NOTES) {
        throw new Error(`This project's notes thread already has ${MAX_NOTES} entries`);
      }
      data.notes.push(note);
      return data.notes;
    });

    return NextResponse.json({ projectId: id, notes }, { status: 201 });
  } catch (err) {
    return badRequest(err);
  }
}
