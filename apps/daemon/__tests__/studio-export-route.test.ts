/**
 * `GET .../designs/:did/export` — D7 DC-1 (OD-109 … OD-115).
 *
 * `packages/exporters` had tests and one consumer, the legacy desktop app
 * (now only in the ligma-classic repo), so a ligma
 * user could not export a design at all. These are golden checks per format
 * family: the response is a real file of the right type (magic bytes where the
 * format has them), it names itself in `Content-Disposition`, and it carries
 * the *snapshot's* bytes rather than whatever is on the working tree.
 *
 * PDF is exercised only for its failure contract — it shells out to a system
 * Chrome, which a test must not depend on.
 */

import { mkdtempSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-studio-export-'));
process.env.LIGMA_DATA_DIR = dataDir;

const { DaemonRequest } = await import('../src/http');
const { GET } = await import('../src/routes/projects/_id/designs/_did/export/route');
const { sourceDir } = await import('../src/studio/paths');
const { createDesign, mutateManifest, recordVersion } = await import('../src/studio/store');

const projectId = 'test_studio_export';

let designId = '';
let v1 = '';

async function write(file: string, body: string): Promise<void> {
  const target = path.join(sourceDir(projectId, designId), file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body, 'utf-8');
}

function get(query = '', did = designId): Promise<Response> {
  return Promise.resolve(
    GET(
      new DaemonRequest(`http://127.0.0.1/api/projects/${projectId}/designs/${did}/export${query}`),
      {
        params: Promise.resolve({ id: projectId, did }),
      },
    ),
  );
}

async function bytesOf(res: Response): Promise<Buffer> {
  return Buffer.from(await res.arrayBuffer());
}

beforeAll(async () => {
  const design = await createDesign({
    projectId,
    title: 'Checkout Flow',
    prompt: 'p',
    designSystem: null,
  });
  designId = design.id;

  await write('index.html', '<h1>Checkout</h1><p>Pay now</p>');
  await write('confirm.html', '<h1>Confirmed</h1>');
  await write('tokens.css', ':root{--accent:red}');
  v1 = (await mutateManifest(projectId, designId, (m) => recordVersion(m, 'prompt', 'v1')))!.id;

  // A later, unexported edit: an export must serve the snapshot, not the tree.
  await write('index.html', '<h1>UNSNAPSHOTTED</h1>');
});

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe('GET /api/projects/:id/designs/:did/export', () => {
  it('zips the whole design, named after it', async () => {
    const res = await get('?format=zip');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="checkout-flow-v1.zip"',
    );

    const zip = await bytesOf(res);
    // PK\x03\x04 — a real archive, not an error page with a zip mime type.
    expect(zip.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(zip.byteLength).toBeGreaterThan(100);
  });

  it('exports standalone HTML from the snapshot, not the working tree', async () => {
    const res = await get('?format=html');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');

    const html = (await bytesOf(res)).toString('utf-8');
    expect(html).toContain('<h1>Checkout</h1>');
    expect(html).not.toContain('UNSNAPSHOTTED');
    expect(html.toLowerCase()).toContain('<!doctype html');
  });

  it('exports Markdown', async () => {
    const res = await get('?format=markdown');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('.md');
    const md = (await bytesOf(res)).toString('utf-8');
    expect(md).toContain('Checkout');
    expect(md.length).toBeGreaterThan(0);
  });

  it('exports a real PPTX (an OOXML zip)', async () => {
    const res = await get('?format=pptx');
    expect(res.status).toBe(200);
    const pptx = await bytesOf(res);
    expect(pptx.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(pptx.byteLength).toBeGreaterThan(1000);
  });

  it('defaults to zip', async () => {
    const res = await get();
    expect(res.headers.get('content-type')).toBe('application/zip');
  });

  it('rejects an unknown format instead of guessing', async () => {
    const res = await get('?format=docx');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('EXPORTER_UNKNOWN');
  });

  it('404s an unknown design and an unknown version', async () => {
    expect((await get('?format=zip', 'design_nope')).status).toBe(404);
    expect((await get('?format=zip&versionId=ver_nope')).status).toBe(404);
  });

  it('exports a named historical version', async () => {
    const res = await get(`?format=html&versionId=${v1}`);
    expect(res.status).toBe(200);
    expect((await bytesOf(res)).toString('utf-8')).toContain('<h1>Checkout</h1>');
  });

  it('answers 503 with the code intact when PDF cannot find a Chrome', async () => {
    const previous = process.env.LIGMA_CHROME_PATH;
    process.env.LIGMA_CHROME_PATH = path.join(dataDir, 'no-such-chrome');
    try {
      const res = await get('?format=pdf');
      // Either a real Chrome was discovered anyway (200) or the failure is
      // classified — never an unlabelled 500.
      if (res.status !== 200) {
        expect(res.status).toBe(503);
        expect(((await res.json()) as { code: string }).code).toBe('EXPORTER_NO_CHROME');
      }
    } finally {
      if (previous === undefined) delete process.env.LIGMA_CHROME_PATH;
      else process.env.LIGMA_CHROME_PATH = previous;
    }
  });

  it('409s a design that has never been snapshotted', async () => {
    const empty = await createDesign({
      projectId,
      title: 'empty',
      prompt: 'p',
      designSystem: null,
    });
    const res = await get('?format=zip', empty.id);
    expect(res.status).toBe(409);
  });
});
