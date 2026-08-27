/**
 * `POST /api/library-meta/use` — bump a catalog entry's use count (OD-156).
 *
 * Fired whenever an entry is applied or copied. The Library's own detail
 * panes fire it for the skill catalog and craft rules ("Copy" actions); a
 * design system is applied from the Studio's kickoff composer, outside this
 * feature's files — see `studio-surface.tsx`'s `submitPrompt`, which is the
 * one-line fire handoff (reported alongside this route, not applied here).
 */
import { NextResponse } from '../../../http';
import { validateBody } from '../../../store/validations';
import { mutateLibraryMeta, recordUse } from '../store';
import { libraryMetaUseSchema } from '../validations';

export async function POST(request: Request): Promise<Response> {
  const validation = await validateBody(request, libraryMetaUseSchema);
  if (!validation.success) return validation.error;
  const { kind, id } = validation.data;

  const entry = await mutateLibraryMeta((data) => recordUse(data, kind, id));
  return NextResponse.json(entry);
}
