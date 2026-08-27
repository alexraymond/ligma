import { type NextRequest, NextResponse } from '../../http';
import { cachedPreflight } from './_lib';

// GET /api/env-preflight?refresh=1 — will ephemeral env creation work here?
export async function GET(request: NextRequest) {
  const force = request.nextUrl.searchParams.get('refresh') === '1';
  return NextResponse.json(cachedPreflight(force));
}
