import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { RunArtifact } from '@ligma/api';
import { NextResponse } from '../../../../http';
import {
  PathSafetyError,
  assertRealpathContained,
  getVerificationRunsRoot,
  isSafeSegment,
  safeResolve,
} from '../../_lib';

/**
 * Every file a run produced — including the ~50-70 screenshots per persona the
 * bridge captures that nothing in the verdict cites. The UI needs the whole set
 * so uncited evidence stops being invisible.
 */

// ponytail: flat cap instead of pagination — a run is ~130 files today. Add
// paging if runs ever get big enough that this listing is the slow part.
const MAX_ENTRIES = 5000;

function kindFor(relPath: string): RunArtifact['kind'] {
  const base = path.basename(relPath).toLowerCase();
  if (/\.(png|jpe?g)$/.test(base)) return 'screenshot';
  if (base === 'steps.jsonl') return 'steps';
  if (base === 'transcript.jsonl') return 'transcript';
  if (base.endsWith('.json')) return 'report';
  return 'other';
}

async function walk(runDir: string, relDir: string, out: RunArtifact[]): Promise<void> {
  const entries = await readdir(path.join(runDir, relDir), { withFileTypes: true });
  for (const entry of entries) {
    if (out.length >= MAX_ENTRIES) return;
    // Symlinks are never followed — a link planted in a run dir must not become
    // a readable path outside it.
    if (entry.isSymbolicLink()) continue;
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walk(runDir, rel, out);
    } else if (entry.isFile()) {
      const { size } = await stat(path.join(runDir, rel));
      out.push({ path: rel, size, kind: kindFor(rel) });
    }
  }
}

// GET /api/verification-runs/[id]/artifacts — recursive file listing for a run.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSafeSegment(id)) {
    return NextResponse.json({ error: 'Invalid run id' }, { status: 400 });
  }

  const root = getVerificationRunsRoot();
  let runDir: string;
  try {
    runDir = safeResolve(root, id);
    await assertRealpathContained(root, runDir);
  } catch (err) {
    if (err instanceof PathSafetyError) {
      return NextResponse.json({ error: 'Invalid run id' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Verification run not found' }, { status: 404 });
  }

  const artifacts: RunArtifact[] = [];
  try {
    await walk(runDir, '', artifacts);
  } catch {
    return NextResponse.json({ error: 'Verification run not found' }, { status: 404 });
  }

  artifacts.sort((a, b) => a.path.localeCompare(b.path));
  return NextResponse.json({ artifacts, truncated: artifacts.length >= MAX_ENTRIES });
}
