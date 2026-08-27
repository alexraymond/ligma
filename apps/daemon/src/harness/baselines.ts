/**
 * baselines.ts — characterization baselines, stored CENTRALLY (twin-primitives §3).
 *
 *   data/projects/<projectId>/baselines/<journeyId>.json
 *   data/projects/<projectId>/probes/                     (regression probes, later)
 *
 * The visibility split this module exists to enforce: journeys are in the repo
 * because what users do is public; baselines are NOT, because what the judge
 * expects is not. The builder edits the target repo, so a baseline living there
 * is a teach-to-the-test leak. `CENTRAL_PROJECT_GLOB` is what the spawn deny
 * rules (engine/config.ts `denyRulesForRole`) point at.
 *
 * For a brownfield repo with no written oracle the first panel run records what
 * the product currently does; later runs are judged comparatively against it.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { BaselineObservation, JourneyBaseline } from '@ligma/api';
import { CENTRAL_PROJECTS_DIR } from '../paths';

export { CENTRAL_PROJECTS_DIR };

/** basename() keeps a hostile id ("../../tasks.json") inside the store. */
function safe(id: string): string {
  const base = path.basename(id);
  if (!base || base === '.' || base === '..') throw new Error(`Unsafe id: ${id}`);
  return base;
}

export function baselinesDir(projectId: string): string {
  return path.join(CENTRAL_PROJECTS_DIR, safe(projectId), 'baselines');
}

export function probesDir(projectId: string): string {
  return path.join(CENTRAL_PROJECTS_DIR, safe(projectId), 'probes');
}

export function baselinePath(projectId: string, journeyId: string): string {
  return path.join(baselinesDir(projectId), `${safe(journeyId)}.json`);
}

export function readBaseline(projectId: string, journeyId: string): JourneyBaseline | null {
  const file = baselinePath(projectId, journeyId);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as JourneyBaseline;
  } catch {
    // A corrupt baseline is no baseline: the run characterizes again rather
    // than judging against bytes it cannot read.
    console.error(`[harness/baselines] unreadable baseline ${file}`);
    return null;
  }
}

export function listBaselines(projectId: string): JourneyBaseline[] {
  const dir = baselinesDir(projectId);
  if (!existsSync(dir)) return [];
  const out: JourneyBaseline[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    const one = readBaseline(projectId, name.slice(0, -'.json'.length));
    if (one) out.push(one);
  }
  return out;
}

/**
 * The cited evidence, read as fields instead of a sentence.
 *
 * The bridge wrote the record; the persona could only choose which one to point
 * at. So a status code, an exit code or a response schema in here is an
 * observation, never a claim — and the next run compares numbers rather than
 * diffing prose. Undefined when nothing was cited or the record is unreadable:
 * an absent observation characterizes nothing, which is the honest value.
 */
export function observationOf(
  runDir: string,
  relPath: string | null,
): BaselineObservation | undefined {
  if (!relPath) return undefined;
  if (relPath.endsWith('.png')) return { transport: 'browser' };
  if (!relPath.endsWith('.json') || !relPath.includes('/records/')) return undefined;

  let record: Record<string, unknown>;
  try {
    record = JSON.parse(readFileSync(path.join(runDir, relPath), 'utf-8')) as Record<
      string,
      unknown
    >;
  } catch {
    return undefined;
  }

  if (Array.isArray(record.argv)) {
    return {
      transport: 'pty',
      ...(typeof record.exitCode === 'number' ? { exitCode: record.exitCode } : {}),
    };
  }
  if (typeof record.method === 'string') {
    return {
      transport: 'http',
      ...(typeof record.status === 'number' ? { status: record.status } : {}),
      ...(typeof record.schema === 'string' ? { schema: record.schema } : {}),
    };
  }
  return undefined;
}

/**
 * Record the characterization baseline for a journey. Overwrites: the newest
 * characterization is the one later runs compare against, and the run that
 * produced it is named in `runId` so the evidence is always reachable.
 */
export function writeBaseline(baseline: JourneyBaseline): string {
  const file = baselinePath(baseline.projectId, baseline.journeyId);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(baseline, null, 2)}\n`, 'utf-8');
  return file;
}
