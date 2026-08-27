/**
 * POST /api/projects/:id/brief/amend — edit one already-answered discovery
 * question, in place, after the fact.
 *
 * The sibling `answers/route.ts` only ever accepts the currently open form,
 * and refuses a stale one with "That form is no longer the open one" — on
 * purpose, for the stale-client case. This route is the other half: a human
 * rereading the thread who wants to correct something answered turns ago. It
 * never touches the open form, and a locked brief is not a reason to refuse —
 * `applyAmendment` sets `staleFlaggedAt` instead, which is the Deck card that
 * tells the human their locked brief just moved (build brief §16 Phase 2).
 *
 * Every amendment also appends an ANSWERED `DecisionItem` — the audit trail a
 * silent in-place edit would not otherwise leave. `consequenceTaskIds` is `[]`
 * today because nothing downstream re-runs off an amendment yet; the field
 * exists so that wiring has somewhere to write to later, per the contract.
 */

import type { DecisionItem } from '@ligma/api';
import { z } from 'zod';
import { applyAmendment, readBrief, writeBrief } from '../../../../../engine/discovery';
import { NextResponse } from '../../../../../http';
import { mutateDecisions, mutateProjects } from '../../../../../store/data';
import { generateId } from '../../../../../store/ids';
import { validateBody } from '../../../../../store/validations';

const amendSchema = z.object({
  formId: z.string().min(1).max(60),
  questionId: z.string().min(1).max(60),
  answer: z.union([z.string().max(5000), z.array(z.string().max(500)).max(20)]),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const validation = await validateBody(request, amendSchema);
  if (!validation.success) return validation.error;
  const { formId, questionId, answer } = validation.data;

  const stored = readBrief(id);
  if (!stored) return NextResponse.json({ error: 'No brief for this project' }, { status: 404 });

  let amended: ReturnType<typeof applyAmendment>;
  try {
    amended = applyAmendment(stored, formId, questionId, answer);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 409 },
    );
  }

  writeBrief(amended.brief);

  if (amended.shape) {
    const shape = amended.shape;
    await mutateProjects(async (data) => {
      const row = data.projects.find((p) => p.id === id);
      if (row) row.shape = shape;
    });
  }

  const decision = await mutateDecisions(async (data) => {
    const item: DecisionItem = {
      id: generateId('dec'),
      requestedBy: 'system',
      taskId: null,
      question: `Brief answer changed — ${amended.questionLabel}`,
      options: [],
      context: `Amended on the brief thread for project ${id}.`,
      status: 'answered',
      answer: Array.isArray(answer) ? answer.join(', ') : answer,
      answeredAt: amended.brief.updatedAt,
      createdAt: amended.brief.updatedAt,
      // Nothing downstream re-derives off an amendment yet — the field exists
      // so that wiring has somewhere to write to when it does.
      consequenceTaskIds: [],
    };
    data.decisions.push(item);
    return item;
  });

  return NextResponse.json({
    ok: true,
    decisionId: decision.id,
    staleFlagged: amended.staleFlagged,
  });
}
