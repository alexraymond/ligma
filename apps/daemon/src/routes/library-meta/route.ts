/**
 * `GET /api/library-meta` — every catalog entry's use count and bookmark
 * (OD-156/157). Mutations live at their own paths, `use/route.ts` and
 * `bookmark/route.ts` — one intent per endpoint, matching the
 * `checkpoints/export`, `checkpoints/import` sibling-folder pattern already in
 * this routes tree, rather than a single route overloaded on a body field.
 */
import type { LibraryMetaResponse } from '@ligma/api';
import { NextResponse } from '../../http';
import { listLibraryMeta, readLibraryMeta } from './store';

export async function GET(): Promise<Response> {
  const data = await readLibraryMeta();
  const body: LibraryMetaResponse = { entries: listLibraryMeta(data) };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'private, max-age=2' } });
}
