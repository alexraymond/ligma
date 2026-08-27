/**
 * cachedConfig() — loadConfig() was a hot path.
 *
 * The governor called it on every decision (twice per gate), the health monitor
 * on every status flush and awaitSpawn every 30s while waiting, so a read+parse+
 * validate ran dozens of times a minute and the "[SECURITY] skipPermissions" and
 * "Allowed tools" lines drowned the log they exist to be noticed in.
 *
 * The cache is keyed on the file's mtime, so an edit must still take effect
 * immediately — a stale config is a worse bug than a slow one.
 */

import { readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getConfigPath } from '../src/engine/config';
import { cachedConfig, invalidateConfigCache } from '../src/engine/config-cache';

const CONFIG_FILE = getConfigPath();
let original: string;

beforeEach(() => {
  original = readFileSync(CONFIG_FILE, 'utf-8');
  invalidateConfigCache();
});

afterEach(() => {
  writeFileSync(CONFIG_FILE, original, 'utf-8');
  invalidateConfigCache();
});

describe('cachedConfig', () => {
  it('returns the very same object while the file is untouched', () => {
    const a = cachedConfig();
    const b = cachedConfig();
    expect(b).toBe(a);
  });

  it('reloads as soon as the file changes', () => {
    const before = cachedConfig().concurrency.maxParallelAgents;

    const config = JSON.parse(original) as { concurrency: { maxParallelAgents: number } };
    config.concurrency.maxParallelAgents = before === 7 ? 6 : 7;
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
    // Same-millisecond writes are possible on a coarse clock; make the mtime move.
    const future = new Date(Date.now() + 2000);
    utimesSync(CONFIG_FILE, future, future);

    expect(cachedConfig().concurrency.maxParallelAgents).toBe(config.concurrency.maxParallelAgents);
    expect(cachedConfig().concurrency.maxParallelAgents).not.toBe(before);
  });
});
