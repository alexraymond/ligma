import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { VerificationRunManifest } from '@ligma/api';
import { type NextRequest, NextResponse } from '../../http';
import { getVerificationRunsRoot } from './_lib';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// GET /api/verification-runs?limit=N&taskId=X&projectId=Y — list run manifests, newest first.
//
// Run directories are named vrun_<ms-since-epoch>, so a plain descending sort
// of the directory names IS newest-first — no need to open every run.json just
// to sort by startedAt. We walk that order and stop as soon as we have `limit`
// matches (immediately, when there's no taskId/projectId filter), so
// ?limit=1 opens one file instead of the whole history, and a filtered query
// only reads as far into history as it has to.
export async function GET(request: NextRequest) {
  const root = getVerificationRunsRoot();
  const limitParam = request.nextUrl.searchParams.get('limit');
  const limit = Math.min(Math.max(1, Number(limitParam) || DEFAULT_LIMIT), MAX_LIMIT);
  const taskId = request.nextUrl.searchParams.get('taskId');
  const projectId = request.nextUrl.searchParams.get('projectId');

  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    // Root doesn't exist yet — no runs, not an error.
    return NextResponse.json({ runs: [] });
  }

  entries.sort().reverse();

  const manifests: VerificationRunManifest[] = [];
  for (const entry of entries) {
    if (manifests.length >= limit) break;
    try {
      const raw = await readFile(path.join(root, entry, 'run.json'), 'utf-8');
      const manifest = JSON.parse(raw) as VerificationRunManifest;
      if (taskId && manifest.taskId !== taskId) continue;
      if (projectId && manifest.projectId !== projectId) continue;
      manifests.push(manifest);
    } catch {
      // Not a run directory (missing/invalid run.json) — skip it.
    }
  }

  return NextResponse.json({ runs: manifests });
}
