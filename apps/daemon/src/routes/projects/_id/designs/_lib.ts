/**
 * Shared plumbing for the studio routes.
 *
 * The handlers are deliberately thin — they parse, delegate to `src/studio/*`,
 * and shape a response. Anything that decides something belongs in the studio
 * module, so the CLI and the web app cannot end up with different behaviour by
 * calling different entry points.
 */

import type { DesignManifest } from '@ligma/api';
import { NextResponse } from '../../../../http';
import { readManifest } from '../../../../studio/store';

export function badRequest(err: unknown, status = 400): Response {
  return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
}

/** Parse a JSON body, tolerating an empty one as `{}`. */
export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.trim() === '') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object')
      throw new Error('body must be a JSON object');
    return parsed as Record<string, unknown>;
  } catch (err) {
    throw new Error(`invalid JSON body: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export type DesignLookup =
  | { ok: true; manifest: DesignManifest }
  | { ok: false; response: Response };

/** Load a design or produce the 404, so every handler answers the same way. */
export async function requireDesign(projectId: string, designId: string): Promise<DesignLookup> {
  try {
    const manifest = await readManifest(projectId, designId);
    if (!manifest) {
      return {
        ok: false,
        response: NextResponse.json({ error: `Design not found: ${designId}` }, { status: 404 }),
      };
    }
    return { ok: true, manifest };
  } catch (err) {
    // A malformed id (which is a path segment) or an unreadable manifest.
    return { ok: false, response: badRequest(err) };
  }
}
