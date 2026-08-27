/**
 * config-cache.ts — loadConfig() memoized on the config file's mtime.
 *
 * loadConfig() reads, parses, validates and LOGS. The quota governor called it on
 * every decision (twice per gate), the health monitor on every status flush, and
 * awaitSpawn every 30s while waiting — which turned a config read into a hot path
 * and spammed the "[SECURITY] skipPermissions" / "Allowed tools" lines dozens of
 * times a minute, drowning the log the warning exists to be seen in.
 *
 * Keyed on mtime rather than a TTL: a config edit still takes effect on the very
 * next call (the daemon's hot-reload keeps working, and no test has to wait out a
 * timer), while an unchanged file costs one stat instead of a parse + validate.
 * The log lines therefore fire on change, which is when they mean something.
 */

import { statSync } from 'node:fs';
import { getConfigPath, loadConfig } from './config';
import type { DaemonConfig } from './types';

let cache: { key: string; config: DaemonConfig } | null = null;

/** mtime+size of the config file; "missing" when it isn't there yet. */
function fileKey(): string {
  try {
    const stat = statSync(getConfigPath());
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return 'missing';
  }
}

export function cachedConfig(): DaemonConfig {
  const key = fileKey();
  if (cache && cache.key === key) return cache.config;
  const config = loadConfig();
  cache = { key, config };
  return config;
}

/** For tests that rewrite the config within the same millisecond. */
export function invalidateConfigCache(): void {
  cache = null;
}
