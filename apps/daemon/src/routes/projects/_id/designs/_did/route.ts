/**
 * GET /api/projects/:id/designs/:did — the whole design session state.
 *
 * Returns the manifest as-is: the rail, the staged pins, the tweak schema and
 * values, and the critique. One request rebuilds the entire Studio view, so a
 * reload never shows a design in a partially-known state.
 *
 * PATCH changes the one thing about a session that is a *choice* rather than a
 * record: which design system it draws against. Everything else on the
 * manifest is history or a verdict, and neither is editable.
 */

import { NextResponse } from '../../../../../http';
import { assertSafeDesignSystem } from '../../../../../studio/paths';
import { isTurnInFlight } from '../../../../../studio/session';
import { mutateManifest, toSnapshotSummary, toSummary } from '../../../../../studio/store';
import { rootForSystem } from '../../../../design-systems/route';
import { badRequest, jsonBody, requireDesign } from '../_lib';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; did: string }> },
) {
  const { id, did } = await params;
  const found = await requireDesign(id, did);
  if (!found.ok) return found.response;

  const { manifest } = found;
  return NextResponse.json({
    design: manifest,
    summary: toSummary(manifest),
    snapshots: manifest.versions.map(toSnapshotSummary),
    turnInFlight: isTurnInFlight(did),
  });
}

/**
 * PATCH — swap the design system mid-session.
 *
 * It takes effect on the *next* turn, by construction rather than by promise:
 * `startTurn` re-reads the manifest every time, so the swap is visible to the
 * turn after this one and cannot disturb one already in flight. Nothing
 * regenerates here — the design you are looking at was drawn against the old
 * system and still is until you ask for something.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; did: string }> },
) {
  const { id, did } = await params;
  const found = await requireDesign(id, did);
  if (!found.ok) return found.response;

  try {
    const body = await jsonBody(request);
    if (!('designSystem' in body)) throw new Error('nothing to change — send `designSystem`');
    const raw = body.designSystem;
    if (raw !== null && typeof raw !== 'string')
      throw new Error('`designSystem` must be a slug or null');
    const slug = assertSafeDesignSystem(raw);
    // A slug that names no package would silently produce a prompt that says
    // "its DESIGN.md could not be read" on every turn from now on.
    if (slug !== null && !(await rootForSystem(slug)))
      throw new Error(`No design system called "${slug}"`);

    const manifest = await mutateManifest(id, did, (current) => {
      current.designSystem = slug;
      return current;
    });
    return NextResponse.json({ design: manifest, summary: toSummary(manifest) });
  } catch (err) {
    return badRequest(err);
  }
}
