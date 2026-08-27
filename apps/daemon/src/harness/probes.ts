/**
 * probes.ts — the regression corpus (UX spec §6 Verify).
 *
 * When a verdict lands `failed`, every criterion the judge ruled against is
 * recorded here as a **probe**: the journey (or task) it came from, the
 * criterion, the failing step's own record, and the verdict that filed it.
 *
 * There is deliberately **no replay engine**. Re-asking a probe is "Prove it" on
 * its journey: the same criterion is judged again against the same baseline
 * comparison that already exists. A probe is the corpus entry — what was caught
 * and where — not a second way to run it.
 *
 * Storage is central (`data/projects/<id>/probes/`, the slot `baselines.ts`
 * reserved) and under the same deny rules: a builder that could read the corpus
 * would be reading the list of things it is about to be tested on.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AcceptanceContract, RegressionProbe, VerificationVerdict } from '@ligma/api';
import { withFileLock } from '../engine/file-lock';
import { probesDir } from './baselines';

/** One file per probe, named by its id — append-shaped, never rewritten in place. */
function probePath(projectId: string, probeId: string): string {
  return path.join(probesDir(projectId), `${path.basename(probeId)}.json`);
}

export function listProbes(projectId: string): RegressionProbe[] {
  const dir = probesDir(projectId);
  if (!existsSync(dir)) return [];
  const out: RegressionProbe[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(readFileSync(path.join(dir, name), 'utf-8')) as RegressionProbe);
    } catch {
      // A corrupt probe is one lost corpus entry, not a broken Verify tab.
      console.error(`[harness/probes] unreadable probe ${name}`);
    }
  }
  // Newest first: the corpus reads as "what has been going wrong lately".
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * File the probes a failed verdict implies. Returns what was written.
 *
 * Idempotent by construction: the probe id is derived from the run and the
 * criterion, so re-processing the same verdict overwrites rather than
 * duplicating. A `passed` or `error` verdict files nothing — an `error` proved
 * nothing about the product and must never enter a corpus of product defects
 * (principle 12).
 */
export function recordProbes(
  projectId: string,
  verdict: VerificationVerdict,
  contract: AcceptanceContract | null,
): RegressionProbe[] {
  if (verdict.outcome !== 'failed') return [];

  const failures = verdict.criterionVerdicts.filter((c) => c.status !== 'met');
  if (failures.length === 0) return [];

  const createdAt = new Date().toISOString();
  const probes = failures.map((failure): RegressionProbe => {
    const criterion = contract?.criteria.find((c) => c.id === failure.criterionId);
    return {
      id: `probe_${verdict.runId}_${failure.criterionId}`,
      projectId,
      journeyId: verdict.journeyId ?? null,
      taskId: verdict.taskId,
      criterionId: failure.criterionId,
      // The contract holds the wording; naming the unresolved id is still
      // better than filing a probe with nothing to re-ask.
      criterionText: criterion?.text ?? failure.criterionId,
      // The cited evidence IS the failing step's record — the bridge wrote it,
      // the persona only chose to point at it.
      recordPath: failure.evidence[0] ?? null,
      reasoning: failure.reasoning,
      runId: verdict.runId,
      createdAt,
    };
  });

  withFileLock(`probes-${path.basename(projectId)}`, () => {
    mkdirSync(probesDir(projectId), { recursive: true });
    for (const probe of probes) {
      writeFileSync(probePath(projectId, probe.id), `${JSON.stringify(probe, null, 2)}\n`, 'utf-8');
    }
  });

  return probes;
}
