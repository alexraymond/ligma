import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
/**
 * The three-tier resolution order for the product-repo root (OD-097):
 * `LIGMA_PRODUCTS_DIR` env var > daemon-config `storage.productsDir` > the
 * `~/ligma-products` default. Own temp data dir so it doesn't collide with
 * product-repo.test.ts's own env vars.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-root-data-'));
process.env.LIGMA_DATA_DIR = dataDir;
delete process.env.LIGMA_PRODUCTS_DIR;

const { productsRootInfo } = await import('../src/store/product-repo');
const { loadConfig, saveConfig } = await import('../src/engine/config');
const { invalidateConfigCache } = await import('../src/engine/config-cache');

/** `productsRootInfo` reads through the mtime-keyed cache (config-cache.ts) —
 * a same-millisecond rewrite in a test needs an explicit bust, same as
 * governor-config-route.test.ts. */
function setStorage(productsDir: string | null): void {
  saveConfig({ ...loadConfig(), storage: { productsDir } });
  invalidateConfigCache();
}

afterEach(() => {
  delete process.env.LIGMA_PRODUCTS_DIR;
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('productsRootInfo', () => {
  it('falls back to the ~/ligma-products default when nothing is set', () => {
    const info = productsRootInfo();
    expect(info.source).toBe('default');
    expect(info.path).toBe(path.join(os.homedir(), 'ligma-products'));
  });

  it('prefers a configured daemon-config root over the default', () => {
    const custom = path.join(os.tmpdir(), 'ligma-configured-products');
    setStorage(custom);

    const info = productsRootInfo();
    expect(info.source).toBe('configured');
    expect(info.path).toBe(path.resolve(custom));
  });

  it('still lets LIGMA_PRODUCTS_DIR win over a configured value', () => {
    const custom = path.join(os.tmpdir(), 'ligma-configured-products');
    setStorage(custom);
    process.env.LIGMA_PRODUCTS_DIR = path.join(os.tmpdir(), 'ligma-env-products');

    const info = productsRootInfo();
    expect(info.source).toBe('env');
    expect(info.path).toBe(path.resolve(process.env.LIGMA_PRODUCTS_DIR));
  });
});
