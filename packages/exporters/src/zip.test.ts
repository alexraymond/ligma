import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportMultiFileZip, exportZip } from './zip';

let tempDir = '';

beforeAll(() => {
  tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'ligma-zip-test-')));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('exportZip', () => {
  it('writes a multi-asset bundle with index.html, README.md and assets/', async () => {
    const dest = join(tempDir, 'bundle.zip');
    const result = await exportZip('<h1>hi</h1>', dest, {
      assets: [
        { path: 'assets/logo.svg', content: '<svg></svg>' },
        { path: 'assets/data.bin', content: Buffer.from([1, 2, 3, 4]) },
      ],
      readmeTitle: 'Test bundle',
    });

    expect(existsSync(dest)).toBe(true);
    expect(result.bytes).toBeGreaterThan(100);

    const { Unzip } = await import('zip-lib');
    const extractDir = join(tempDir, 'extracted');
    const unzip = new Unzip();
    await unzip.extract(dest, extractDir);

    expect(existsSync(join(extractDir, 'index.html'))).toBe(true);
    expect(existsSync(join(extractDir, 'README.md'))).toBe(true);
    expect(existsSync(join(extractDir, 'assets', 'logo.svg'))).toBe(true);
    expect(existsSync(join(extractDir, 'assets', 'data.bin'))).toBe(true);

    const { readFile } = await import('node:fs/promises');
    const readme = await readFile(join(extractDir, 'README.md'), 'utf8');
    expect(readme).toContain('Test bundle');
    expect(readme).toContain('ligma');
  });

  it('produces a valid zip without any extra assets', async () => {
    const dest = join(tempDir, 'minimal.zip');
    const result = await exportZip('<p>x</p>', dest);
    expect(result.bytes).toBeGreaterThan(50);
  });

  it('throws EXPORTER_ZIP_FAILED when the destination cannot be written', async () => {
    // Pass a directory as the destination — zip-lib will fail to write a regular file there.
    await expect(exportZip('<p>x</p>', tempDir)).rejects.toMatchObject({
      code: 'EXPORTER_ZIP_FAILED',
    });
  });

  it('rejects asset paths that escape the staging directory (zip-slip)', async () => {
    const dest = join(tempDir, 'unsafe.zip');
    await expect(
      exportZip('<p>x</p>', dest, {
        assets: [{ path: '../escape.txt', content: 'pwn' }],
      }),
    ).rejects.toMatchObject({ code: 'EXPORTER_ZIP_UNSAFE_PATH' });
    await expect(
      exportZip('<p>x</p>', dest, {
        assets: [{ path: 'assets/../../escape.txt', content: 'pwn' }],
      }),
    ).rejects.toMatchObject({ code: 'EXPORTER_ZIP_UNSAFE_PATH' });
    // Windows-style backslash traversal — must be rejected on POSIX too,
    // since ZIP entries authored on Windows can carry `\` separators.
    await expect(
      exportZip('<p>x</p>', dest, {
        assets: [{ path: '..\\..\\etc\\passwd', content: 'pwn' }],
      }),
    ).rejects.toMatchObject({ code: 'EXPORTER_ZIP_UNSAFE_PATH' });
    await expect(
      exportZip('<p>x</p>', dest, {
        assets: [{ path: 'assets\\..\\..\\escape.txt', content: 'pwn' }],
      }),
    ).rejects.toMatchObject({ code: 'EXPORTER_ZIP_UNSAFE_PATH' });
  });
});

describe('exportMultiFileZip', () => {
  // P17 — the handoff README used to be written last and unconditionally at
  // README.md, silently replacing a screen the agent named README.md.
  it('never overwrites a user entry named README.md', async () => {
    const dest = join(tempDir, 'multi-readme.zip');
    await exportMultiFileZip(
      [
        { path: 'index.html', content: '<p>index</p>' },
        { path: 'README.md', content: '# the user file' },
      ],
      dest,
    );

    const { Unzip } = await import('zip-lib');
    const extractDir = join(tempDir, 'extracted-multi');
    await new Unzip().extract(dest, extractDir);

    const { readFile } = await import('node:fs/promises');
    expect(await readFile(join(extractDir, 'README.md'), 'utf8')).toBe('# the user file');
    expect(existsSync(join(extractDir, 'README-ligma-export-2.md'))).toBe(true);
  });

  it('uses README.md when the name is free', async () => {
    const dest = join(tempDir, 'multi-plain.zip');
    await exportMultiFileZip([{ path: 'index.html', content: '<p>index</p>' }], dest);

    const { Unzip } = await import('zip-lib');
    const extractDir = join(tempDir, 'extracted-multi-plain');
    await new Unzip().extract(dest, extractDir);
    expect(existsSync(join(extractDir, 'README.md'))).toBe(true);
  });
});
