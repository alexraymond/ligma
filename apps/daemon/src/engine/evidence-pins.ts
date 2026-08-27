/**
 * Evidence pins (UX spec F6) — the store behind "point at the defect in the
 * verdict's own evidence, and the pointing becomes the instruction".
 *
 * Pins live centrally at `data/projects/<id>/evidence-pins.json`, beside the
 * baselines: they are review material, not repo knowledge, and a builder that
 * could read them would be reading the reviewer's marking scheme.
 *
 * The compiled instruction block is served by `GET /api/tasks/:id/evidence-pins`
 * so the builder prompt-builder can append it in one line. That injection is a
 * one-line change in `engine/prompt-builder.ts` and is deliberately NOT made
 * here — that file belongs to another workstream this phase (handoff item).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { type EvidencePin, compilePinInstructions, normalizeEvidencePin } from '@ligma/api';
import { CENTRAL_PROJECTS_DIR } from '../paths';
import { withFileLock } from './file-lock';

function safe(id: string): string {
  const base = path.basename(id);
  if (!base || base === '.' || base === '..') throw new Error(`Unsafe id: ${id}`);
  return base;
}

export function evidencePinsPath(projectId: string): string {
  return path.join(CENTRAL_PROJECTS_DIR, safe(projectId), 'evidence-pins.json');
}

export function readEvidencePins(projectId: string): EvidencePin[] {
  const file = evidencePinsPath(projectId);
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, 'utf-8')) as { pins?: EvidencePin[] };
  // Pins written before records were pinnable carry no `kind` and are images.
  // Normalizing on read is the whole of the migration.
  return (parsed.pins ?? []).map(normalizeEvidencePin);
}

/**
 * Append under a cross-process lock: a pin can be written by the web face while
 * a detached run is reading, and per-process mutexes do not see each other.
 */
export function addEvidencePin(pin: EvidencePin): EvidencePin {
  return withFileLock(`evidence-pins-${safe(pin.projectId)}`, () => {
    const file = evidencePinsPath(pin.projectId);
    mkdirSync(path.dirname(file), { recursive: true });
    const pins = readEvidencePins(pin.projectId);
    pins.push(pin);
    writeFileSync(file, `${JSON.stringify({ pins }, null, 2)}\n`, 'utf-8');
    return pin;
  });
}

/** Every pin filed against one task, across projects, with its compiled block. */
export function pinsForTask(
  projectIds: string[],
  taskId: string,
): { pins: EvidencePin[]; instruction: string } {
  const pins = projectIds
    .flatMap((id) => readEvidencePins(id))
    .filter((p) => p.taskId === taskId && p.disposition === 'feedback');
  return { pins, instruction: compilePinInstructions(pins) };
}
