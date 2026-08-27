/**
 * `GET /api/design-systems/:id/file?path=<rel>` — one file out of a
 * design-system package, verbatim.
 *
 * The catalog route already *lists* what a package carries — the manifest's
 * `preview/` pages, and on disk `USAGE.md`, `components.manifest.json`,
 * `design-tokens.json`, `tailwind-v4.css` and `source/`. None of it was
 * readable: the Library named files nobody could open (D7 OD-071). One
 * byte-serving route answers all of them, because the package directory is a
 * read-only vendored input and the only real question is path safety.
 *
 * Safety is the verification-run file route's, reused rather than re-derived:
 * a bare `:id` segment, `safeResolve` against the package directory, then a
 * realpath re-check so a symlink planted in the tree cannot escape it. GET
 * only — the catalog is never written over HTTP.
 */

import { readFile, stat } from "node:fs/promises";
import { NextResponse, type NextRequest } from "../../../../http";
import { rootForSystem } from "../../route";
import {
  PathSafetyError,
  assertRealpathContained,
  contentTypeFor,
  isSafeSegment,
  safeResolve,
} from "../../../verification-runs/_lib";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!isSafeSegment(id)) {
    return NextResponse.json({ error: "Invalid design system id" }, { status: 400 });
  }

  const relPath = request.nextUrl.searchParams.get("path");
  if (!relPath) {
    return NextResponse.json({ error: "path query param is required" }, { status: 400 });
  }

  // Same overlay the catalog lists from — vendored first, then the wizard's
  // authored store. An id in neither is a 404, not a read of a missing root.
  const located = await rootForSystem(id);
  if (located === null) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
  let target: string;
  let dir: string;
  try {
    dir = safeResolve(located.root, id);
    target = safeResolve(dir, relPath);
  } catch (err) {
    if (err instanceof PathSafetyError) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }
    throw err;
  }

  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error("not a file");
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  try {
    await assertRealpathContained(dir, target);
  } catch (err) {
    if (err instanceof PathSafetyError) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }
    throw err;
  }

  // ponytail: whole-file read. The largest thing in a package is a preview page
  // of a few tens of KB. Stream it if a package ever ships a real asset bundle.
  const buffer = await readFile(target);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": contentTypeFor(target),
      // The catalog is vendored and only changes when the repo does.
      "Cache-Control": "private, max-age=300",
    },
  });
}
