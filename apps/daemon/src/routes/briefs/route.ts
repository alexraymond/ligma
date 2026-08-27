/**
 * POST /api/briefs — the Home composer's submit (UX spec F1 step 1→2).
 *
 * One call creates the project and its Brief stage artifact, then runs the first
 * discovery pass so the caller gets a question form back in the same response.
 * The composer is prompt-first by pinned default (build brief §2); adopting a
 * repo is the other entrance and goes through `/api/projects/adopt`.
 */

import type { Brief, Project } from '@ligma/api';
import { z } from 'zod';
import {
  askNextForm,
  discoveryAgents,
  discoveryFailure,
  newBrief,
  writeBrief,
} from '../../engine/discovery';
import { NextResponse } from '../../http';
import { mutateProjects } from '../../store/data';
import { generateId } from '../../store/ids';
import { validateBody } from '../../store/validations';

const createSchema = z.object({
  prompt: z.string().min(1).max(20_000),
  kind: z.string().min(1).max(80).optional(),
  name: z.string().min(1).max(200).optional(),
});

/**
 * GET /api/briefs — is discovery stubbed?
 *
 * Small on purpose, and it exists for one reason: an e2e run must never spawn an
 * agent, and `reuseExistingServer` means the daemon under test might be one
 * somebody started by hand without the switch. Asking costs nothing; finding out
 * by spending a governor slot costs real allocation.
 */
export function GET() {
  return NextResponse.json({ discoveryStubbed: process.env.LIGMA_DISCOVERY_STUB === '1' });
}

/** First line, trimmed to something that fits a project card. */
function titleFrom(prompt: string): string {
  const line = prompt.split('\n')[0].trim();
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

export async function POST(request: Request) {
  const validation = await validateBody(request, createSchema);
  if (!validation.success) return validation.error;
  const body = validation.data;

  const project = await mutateProjects(async (data) => {
    const created: Project = {
      id: generateId('proj'),
      name: body.name ?? titleFrom(body.prompt),
      // Unset only when the user typed a name — that one must never be
      // overwritten later by the promote planner's proposed title.
      nameIsPlaceholder: body.name === undefined,
      description: body.prompt,
      status: 'active',
      color: '#3b82f6',
      teamMembers: [],
      createdAt: new Date().toISOString(),
      tags: body.kind ? [body.kind] : [],
      deletedAt: null,
      repoPath: null,
    };
    data.projects.push(created);
    return created;
  });

  const draft = newBrief(project.id, body.prompt, body.kind ?? null);
  let brief: Brief;
  try {
    brief = await askNextForm(draft, { agents: discoveryAgents() });
  } catch (err) {
    // The project and its brief still exist — discovery is retryable from the
    // Brief page. A model malfunction is never reported as "this brief failed".
    writeBrief(draft);
    return NextResponse.json({ brief: draft, ...discoveryFailure(err) }, { status: 502 });
  }

  await mutateProjects(async (data) => {
    const row = data.projects.find((p) => p.id === project.id);
    if (row) row.briefId = brief.id;
  });

  return NextResponse.json({ brief: writeBrief(brief) }, { status: 201 });
}
