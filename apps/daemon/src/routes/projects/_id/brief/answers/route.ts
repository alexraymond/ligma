/**
 * POST /api/projects/:id/brief/answers — one answered discovery form.
 *
 * Records the answers, writes the confirmed shape onto the project (the one
 * answer the whole pipeline reads — UX spec §3), and runs the next discovery
 * pass so the caller gets either the next form or a brief ready to lock.
 */

import { missingRequired, openForm } from '@ligma/api';
import { z } from 'zod';
import {
  applyAnswers,
  askNextForm,
  discoveryAgents,
  discoveryFailure,
  readBrief,
  writeBrief,
} from '../../../../../engine/discovery';
import { NextResponse } from '../../../../../http';
import { mutateProjects } from '../../../../../store/data';
import { validateBody } from '../../../../../store/validations';

const answersSchema = z.object({
  formId: z.string().min(1).max(60),
  answers: z.record(
    z.string(),
    z.union([z.string().max(5000), z.array(z.string().max(500)).max(20)]),
  ),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const validation = await validateBody(request, answersSchema);
  if (!validation.success) return validation.error;

  const stored = readBrief(id);
  if (!stored) return NextResponse.json({ error: 'No brief for this project' }, { status: 404 });

  const form = openForm(stored);
  if (!form) return NextResponse.json({ error: 'No open discovery form' }, { status: 409 });

  // Server-side twin of the composer's client gate: the UI names the missing
  // field before submit, and this makes a hand-rolled POST obey the same rule.
  const missing = missingRequired(form, validation.data.answers);
  if (missing.length > 0) {
    return NextResponse.json({ error: `Unanswered: ${missing.join(', ')}` }, { status: 400 });
  }

  let answered: ReturnType<typeof applyAnswers>;
  try {
    answered = applyAnswers(stored, validation.data.formId, validation.data.answers);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 409 },
    );
  }

  if (answered.shape) {
    const shape = answered.shape;
    await mutateProjects(async (data) => {
      const row = data.projects.find((p) => p.id === id);
      if (row) row.shape = shape;
    });
  }

  try {
    return NextResponse.json({
      brief: writeBrief(await askNextForm(answered.brief, { agents: discoveryAgents() })),
    });
  } catch (err) {
    // Harness malfunction, never a product claim: the answers are already saved.
    writeBrief(answered.brief);
    return NextResponse.json({ brief: answered.brief, ...discoveryFailure(err) }, { status: 502 });
  }
}
