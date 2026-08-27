/**
 * GET /api/runs/:id/prompt — what this run was actually asked.
 *
 * The prompt is assembled at spawn from config, the compiled contract and task
 * state that all keep moving, so it is unreconstructable afterwards; run-task
 * writes it down at the moment it uses it, and this serves that file back.
 *
 * 404 with `no prompt recorded` covers both "this run predates the recording"
 * and "no such run" — from here they are the same fact, and inventing a
 * distinction would mean claiming to know a run existed when nothing recorded it.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { runOutputsDir } from '../../../../engine/run-changes';
import { NextResponse } from '../../../../http';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Same sanitization the sibling output route uses: the id becomes a filename,
  // so it must not be able to name a path.
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.join(runOutputsDir(), `${safeId}.prompt.txt`);

  if (!existsSync(filePath)) {
    return NextResponse.json({ error: 'no prompt recorded' }, { status: 404 });
  }

  try {
    return NextResponse.json({ prompt: readFileSync(filePath, 'utf-8') });
  } catch {
    return NextResponse.json({ error: 'no prompt recorded' }, { status: 404 });
  }
}
