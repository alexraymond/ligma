import { type PreflightResult, runPreflight } from '../../env/preflight';

/**
 * A scan shells out to git and pnpm, so it is cheap but not free — and the
 * /launch card polls. 30s of staleness is invisible to a human and removes the
 * cost entirely. `?refresh=1` and every applied fix bypass it.
 */
const CACHE_MS = 30_000;

let cached: { at: number; result: PreflightResult } | null = null;

export function cachedPreflight(force = false): PreflightResult {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.result;
  const result = runPreflight();
  cached = { at: Date.now(), result };
  return result;
}

export function setCachedPreflight(result: PreflightResult): void {
  cached = { at: Date.now(), result };
}
