/**
 * `POST /api/backends/rescan` — drop the cached probe for every backend and
 * probe again. Bodyless: rescanning is all-or-nothing, there is nothing to
 * validate here (no `env-preflight/fix`-style closed-set kind needed).
 *
 * There are TWO caches, and clearing only the probe cache is what made Settings
 * lie (process audit P10): `runner.ts` separately memoizes the RESOLVED BINARY
 * per backend, and that is what every spawn actually uses. A user who pointed
 * ligma at a different CLI build saw "saved" from Settings and "available" from
 * this route while the daemon kept spawning the old binary until a full restart
 * nothing told them to do. Both caches go, in that order, so the fresh probe
 * re-resolves rather than re-reporting the stale resolution.
 */

import { probeAllBackends } from '../../../engine/backend-probe';
import { clearBinaryCache } from '../../../engine/runner';
import { NextResponse } from '../../../http';

export async function POST(): Promise<Response> {
  clearBinaryCache();
  const backends = await probeAllBackends(true);
  return NextResponse.json({ backends });
}
