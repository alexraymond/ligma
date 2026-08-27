/**
 * POST /api/adoption/:runId/review — answer the review sheet in one shot:
 * confirm (or correct) the boot recipe, confirm the shape, and accept / edit /
 * reject each proposed journey as a batch (UX spec F2 step 3).
 *
 * This is the only call that writes into the target repo: `.ligma/boot.json`,
 * the accepted `.ligma/journeys/*.json`, and the confusion log appended to
 * `.ligma/project.md`.
 */

import { z } from 'zod';
import { applyAdoptionReview } from '../../../../engine/adopt-repo';
import { NextResponse } from '../../../../http';
import { bootRecipeSchema } from '../../../../store/ligma-dir';
import { validateBody } from '../../../../store/validations';

const proposalSchema = z.object({
  title: z.string().min(1).max(200),
  goal: z.string().min(1).max(2000),
  steps: z.array(z.string().min(1).max(500)).max(20).default([]),
  tags: z.array(z.string().min(1).max(40)).max(10).default([]),
  rationale: z.string().max(1000).default(''),
});

const reviewSchema = z.object({
  boot: bootRecipeSchema.optional(),
  shape: z.enum(['ui', 'headless', 'mixed']).optional(),
  name: z.string().min(1).max(200).optional(),
  journeys: z
    .array(
      z.object({
        index: z.number().int().min(0).max(100),
        action: z.enum(['accept', 'reject']),
        edited: proposalSchema.optional(),
      }),
    )
    .max(100)
    .default([]),
});

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const validation = await validateBody(request, reviewSchema);
  if (!validation.success) return validation.error;

  try {
    return NextResponse.json(await applyAdoptionReview(runId, validation.data));
  } catch (err) {
    // A zod throw from deeper in (the boot recipe is re-parsed when it is
    // written) used to reach the client as a pretty-printed issue array in one
    // `error` string — parseable, but not the house style every other route
    // speaks (process audit P18). Same `{error, details:[{path,message}]}` the
    // talk route and `validateBody` produce.
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
