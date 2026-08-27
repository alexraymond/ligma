/**
 * `GET /api/design-systems/:id/file` — D7 OD-071.
 *
 * The Library listed the files a vendored package ships (`preview/` pages,
 * `USAGE.md`, the derived manifests) and served none of them. The properties
 * worth holding: the real vendored packages are readable, path safety is the
 * verification-file route's (lexical + realpath), and a directory is not a file.
 */

import { mkdtempSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DaemonRequest } from '../src/http';
import { GET } from '../src/routes/design-systems/_id/file/route';

// The overlay's second root is `<DATA_DIR>/design-systems`. Pin the store to a
// throwaway dir so this suite reads no part of the real one.
process.env.LIGMA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'ligma-ds-file-store-'));

function get(id: string, relPath?: string): Promise<Response> {
  const query = relPath === undefined ? '' : `?path=${encodeURIComponent(relPath)}`;
  return Promise.resolve(
    GET(new DaemonRequest(`http://127.0.0.1/api/design-systems/${id}/file${query}`), {
      params: Promise.resolve({ id }),
    }),
  );
}

afterEach(() => {
  delete process.env.LIGMA_DESIGN_SYSTEMS_DIR;
});

describe('the real vendored catalog', () => {
  it('serves a manifest-declared preview page as HTML', async () => {
    const res = await get('minimal', 'preview/colors.html');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect((await res.text()).length).toBeGreaterThan(0);
  });

  it('serves the files the catalog listing never exposed', async () => {
    for (const [file, type] of [
      ['USAGE.md', 'text/markdown; charset=utf-8'],
      ['design-tokens.json', 'application/json'],
      ['tailwind-v4.css', 'text/css; charset=utf-8'],
      ['components.manifest.json', 'application/json'],
    ] as const) {
      const res = await get('minimal', file);
      expect([file, res.status]).toEqual([file, 200]);
      expect([file, res.headers.get('content-type')]).toEqual([file, type]);
    }
  });

  it('404s a file the package does not ship', async () => {
    expect((await get('minimal', 'preview/nope.html')).status).toBe(404);
  });

  it('404s a directory — a listing is not a file', async () => {
    expect((await get('minimal', 'preview')).status).toBe(404);
  });
});

describe('path safety', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'ligma-ds-file-'));
    await mkdir(path.join(root, 'pkg', 'preview'), { recursive: true });
    await writeFile(path.join(root, 'pkg', 'preview', 'ok.html'), '<p>ok</p>');
    await writeFile(path.join(root, 'secret.txt'), 'not yours');
    await symlink(path.join(root, 'secret.txt'), path.join(root, 'pkg', 'escape.txt'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('rejects a traversing path before touching the filesystem', async () => {
    process.env.LIGMA_DESIGN_SYSTEMS_DIR = root;
    for (const attempt of ['../secret.txt', '../../etc/passwd', '/etc/passwd']) {
      const res = await get('pkg', attempt);
      expect([attempt, res.status]).toEqual([attempt, 400]);
    }
  });

  it('rejects an id that is not a bare segment', async () => {
    process.env.LIGMA_DESIGN_SYSTEMS_DIR = root;
    expect((await get('../..', 'preview/ok.html')).status).toBe(400);
  });

  it('rejects a symlink inside the package that points outside it', async () => {
    process.env.LIGMA_DESIGN_SYSTEMS_DIR = root;
    const res = await get('pkg', 'escape.txt');
    expect(res.status).toBe(400);
  });

  it('requires the path parameter rather than serving a default', async () => {
    process.env.LIGMA_DESIGN_SYSTEMS_DIR = root;
    expect((await get('pkg')).status).toBe(400);
  });

  it('serves a file that really is inside the package', async () => {
    process.env.LIGMA_DESIGN_SYSTEMS_DIR = root;
    const res = await get('pkg', 'preview/ok.html');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<p>ok</p>');
  });
});
