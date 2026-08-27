/**
 * GET/POST /api/projects/:id/evidence-pins — pins on a verdict's evidence
 * screenshots (UX spec F6).
 *
 * A pin is either feedback carried into a fix task's next builder prompt, or a
 * new task in its own right — the human picks in the pin's popover, and this
 * route does what the pick implies. Either way the pointing is stored as
 * structured data and compiled on read; nothing is parsed back out of prose.
 */

import { type EvidencePin, compilePinInstructions } from '@ligma/api';
import type { Task } from '@ligma/api';
import { z } from 'zod';
import { addEvidencePin, readEvidencePins } from '../../../../engine/evidence-pins';
import { NextResponse } from '../../../../http';
import { mutateTasks } from '../../../../store/data';
import { generateId } from '../../../../store/ids';
import { validateBody } from '../../../../store/validations';

const createSchema = z
  .object({
    runId: z.string().min(1).max(120),
    evidencePath: z.string().min(1).max(500),
    /** Absent means an image pin — the shape every caller sent before records. */
    kind: z.enum(['image', 'record']).optional(),
    x: z.number().min(0).max(1).optional(),
    y: z.number().min(0).max(1).optional(),
    line: z.number().int().min(0).max(1_000_000).nullable().optional(),
    field: z.string().min(1).max(200).nullable().optional(),
    comment: z.string().min(1).max(2000),
    disposition: z.enum(['feedback', 'new-task']),
    taskId: z.string().min(1).max(120).optional(),
    title: z.string().min(1).max(200).optional(),
  })
  .refine((b) => b.disposition !== 'feedback' || b.taskId !== undefined, {
    message: 'feedback pins need the task whose next prompt carries them',
    path: ['taskId'],
  })
  .refine((b) => b.kind === 'record' || (b.x !== undefined && b.y !== undefined), {
    message: 'an image pin needs the coordinates it was placed at',
    path: ['x'],
  });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = new URL(request.url).searchParams.get('runId');
  const all = readEvidencePins(id);
  const pins = runId ? all.filter((p) => p.runId === runId) : all;
  return NextResponse.json({ projectId: id, pins, instruction: compilePinInstructions(pins) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const validation = await validateBody(request, createSchema);
  if (!validation.success) return validation.error;
  const body = validation.data;

  let taskId = body.taskId ?? null;
  if (body.disposition === 'new-task') {
    taskId = await createPinTask(
      id,
      body.title ?? body.comment,
      body.comment,
      body.runId,
      body.evidencePath,
    );
  }

  const base = {
    id: generateId('pin'),
    projectId: id,
    runId: body.runId,
    evidencePath: body.evidencePath,
    comment: body.comment,
    disposition: body.disposition,
    taskId,
    createdAt: new Date().toISOString(),
  };
  const pin: EvidencePin =
    body.kind === 'record'
      ? { ...base, kind: 'record', line: body.line ?? null, field: body.field ?? null }
      : // The refine above guarantees both coordinates on this arm.
        { ...base, kind: 'image', x: body.x as number, y: body.y as number };
  addEvidencePin(pin);
  return NextResponse.json({ pin }, { status: 201 });
}

/** The "new task" arm: the pin becomes a real card on the board, linked back. */
async function createPinTask(
  projectId: string,
  title: string,
  comment: string,
  runId: string,
  evidencePath: string,
): Promise<string> {
  const now = new Date().toISOString();
  return mutateTasks(async (data) => {
    const task: Task = {
      id: generateId('task'),
      title: title.length > 120 ? `${title.slice(0, 117)}…` : title,
      // The link back to what made this (seam rule §8.3) lives in the body: the
      // run and the exact evidence file the human was looking at.
      description: `Pinned on verification evidence ${evidencePath} (run ${runId}).\n\n${comment}`,
      // A pinned defect is real work, but the human bumps urgency — a pin is
      // not a page.
      importance: 'important',
      urgency: 'not-urgent',
      kanban: 'not-started',
      verificationStatus: 'unverified',
      projectId,
      milestoneId: null,
      assignedTo: null,
      collaborators: [],
      dailyActions: [],
      subtasks: [],
      blockedBy: [],
      estimatedMinutes: null,
      actualMinutes: null,
      acceptanceCriteria: [],
      comments: [],
      tags: ['evidence-pin'],
      notes: '',
      dueDate: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      deletedAt: null,
    };
    data.tasks.push(task);
    return task.id;
  });
}
