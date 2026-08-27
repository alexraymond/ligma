/**
 * `POST /api/library-meta/bookmark` — set a catalog entry's bookmark
 * (OD-157). `saved` is the target state, not a toggle instruction, so a
 * double-click from two tabs converges instead of flip-flopping.
 */
import { NextResponse } from '../../../http';
import { validateBody } from '../../../store/validations';
import { mutateLibraryMeta, setBookmark } from '../store';
import { libraryMetaBookmarkSchema } from '../validations';

export async function POST(request: Request): Promise<Response> {
  const validation = await validateBody(request, libraryMetaBookmarkSchema);
  if (!validation.success) return validation.error;
  const { kind, id, saved } = validation.data;

  const entry = await mutateLibraryMeta((data) => setBookmark(data, kind, id, saved));
  return NextResponse.json(entry);
}
