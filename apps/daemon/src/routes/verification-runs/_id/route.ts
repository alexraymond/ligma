import { readFile } from 'node:fs/promises';
import type { PersonaReport, VerificationRunManifest, VerificationVerdict } from '@ligma/api';
import { NextResponse } from '../../../http';
import { PathSafetyError, getVerificationRunsRoot, isSafeSegment, safeResolve } from '../_lib';

// GET /api/verification-runs/[id] — run.json + verdict.json + all persona reports, inlined.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSafeSegment(id)) {
    return NextResponse.json({ error: 'Invalid run id' }, { status: 400 });
  }

  const root = getVerificationRunsRoot();
  let runDir: string;
  try {
    runDir = safeResolve(root, id);
  } catch (err) {
    if (err instanceof PathSafetyError) {
      return NextResponse.json({ error: 'Invalid run id' }, { status: 400 });
    }
    throw err;
  }

  let run: VerificationRunManifest;
  try {
    run = JSON.parse(await readFile(safeResolve(runDir, 'run.json'), 'utf-8'));
  } catch (err) {
    if (err instanceof PathSafetyError) {
      return NextResponse.json({ error: 'Invalid run id' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Verification run not found' }, { status: 404 });
  }

  let verdict: VerificationVerdict | null = null;
  if (run.verdictPath) {
    try {
      verdict = JSON.parse(await readFile(safeResolve(runDir, run.verdictPath), 'utf-8'));
    } catch {
      // Verdict missing or unreadable — leave null, run may still be "running".
    }
  }

  const personaReports: PersonaReport[] = [];
  for (const relPath of run.personaReports ?? []) {
    try {
      const abs = safeResolve(runDir, relPath);
      personaReports.push(JSON.parse(await readFile(abs, 'utf-8')));
    } catch {
      // Skip unreadable/invalid persona reports rather than failing the whole run.
    }
  }

  return NextResponse.json({ run, verdict, personaReports });
}
