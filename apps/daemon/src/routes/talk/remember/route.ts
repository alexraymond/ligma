/**
 * POST /api/projects/:id/talk/remember `{messageId}` — "remember this".
 *
 * A statement of intent typed into Talk ("we're dropping X because Y") is only
 * worth anything if planning sees it again, so this lands the message verbatim
 * in `.ligma/project.md` under `## Quirks` — the store that already exists and
 * that `engine/prompt-builder.ts` now injects into every task prompt (UX spec
 * §16: "until a real project-memory store ships").
 *
 * A project with no repo has nowhere to put it. That is a 409 with the reason
 * said plainly, not a silent success — the drawer's button promises a
 * destination, and a promise with no destination is the lie this refuses to
 * tell.
 */

import { z } from 'zod';
import { NextResponse } from '../../../http';
import { appendQuirk } from '../../../store/ligma-dir';
import { badRequest, findProject } from '../../projects/_id/_lib';
import { readTalk } from '../store';

const rememberSchema = z.object({
  messageId: z.string().min(1).max(120),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const project = await findProject(id);
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const parsed = rememberSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed' }, { status: 400 });
    }

    const { messages } = await readTalk(id);
    const message = messages.find((m) => m.id === parsed.data.messageId);
    if (!message)
      return NextResponse.json(
        { error: "Message not found in this project's thread" },
        { status: 404 },
      );

    if (!project.repoPath) {
      return NextResponse.json(
        {
          error:
            'This project has no repo, so there is no .ligma/project.md to remember it in. Set a repoPath on the project first.',
        },
        { status: 409 },
      );
    }

    appendQuirk(
      project.repoPath,
      message.body,
      message.author === 'you' ? 'human' : message.author,
    );
    return NextResponse.json({
      projectId: id,
      messageId: message.id,
      landedIn: '.ligma/project.md → Quirks',
    });
  } catch (err) {
    return badRequest(err);
  }
}
