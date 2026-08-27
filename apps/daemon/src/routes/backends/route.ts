/**
 * `GET /api/backends` — live probe result for claude/codex/gemini.
 *
 * Read-only: this is the list view the settings screen polls. `POST
 * /api/backends/rescan` (sibling route) is the only way to invalidate the
 * per-backend cache; a GET always returns the last probe (or probes fresh on
 * the very first call).
 */

import { probeAllBackends } from '../../engine/backend-probe';
import { type NextRequest, NextResponse } from '../../http';

export async function GET(_request: NextRequest): Promise<Response> {
  const backends = await probeAllBackends();
  return NextResponse.json({ backends }, { headers: { 'Cache-Control': 'private, max-age=5' } });
}
