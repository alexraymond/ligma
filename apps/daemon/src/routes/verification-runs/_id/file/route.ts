import { readFile, stat } from 'node:fs/promises';
import { type NextRequest, NextResponse } from '../../../../http';
import {
  PathSafetyError,
  assertRealpathContained,
  contentTypeFor,
  getVerificationRunsRoot,
  isSafeSegment,
  safeResolve,
} from '../../_lib';

// GET /api/verification-runs/[id]/file?path=<rel> — stream one evidence file
// (png/jsonl/zip/...) from a run's evidence directory. `path` is relative to
// the run root; every segment must resolve inside data/verification-runs.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSafeSegment(id)) {
    return NextResponse.json({ error: 'Invalid run id' }, { status: 400 });
  }

  const relPath = request.nextUrl.searchParams.get('path');
  if (!relPath) {
    return NextResponse.json({ error: 'path query param is required' }, { status: 400 });
  }

  const root = getVerificationRunsRoot();
  let target: string;
  try {
    const runDir = safeResolve(root, id);
    target = safeResolve(runDir, relPath);
  } catch (err) {
    if (err instanceof PathSafetyError) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }
    throw err;
  }

  try {
    await stat(target);
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  try {
    await assertRealpathContained(root, target);
  } catch (err) {
    if (err instanceof PathSafetyError) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }
    throw err;
  }

  // ponytail: files here are small fixtures/screenshots, not multi-GB assets —
  // reading whole-file into memory is simpler than a ReadableStream pipe.
  // Add real streaming if evidence files grow large enough to matter.
  const buffer = await readFile(target);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: { 'Content-Type': contentTypeFor(target) },
  });
}
