import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
/**
 * GET /api/runs/:id/prompt, against a throwaway data dir.
 */
import { afterAll, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-run-prompt-'));
process.env.LIGMA_DATA_DIR = dataDir;
// The route resolves the outputs dir the same way OutputWriter does, so the
// LIGMA_DATA_DIR pin has to be free of a stale MC_RUN_OUTPUTS_DIR override — a
// sibling test file in the same run may have set one.
delete process.env.MC_RUN_OUTPUTS_DIR;

const outputs = path.join(dataDir, 'run-outputs');
mkdirSync(outputs, { recursive: true });

const PROMPT = 'You are the builder.\n\n## Task\nWire the button.\n\n## Acceptance\n- it works\n';
writeFileSync(path.join(outputs, 'run_recorded.prompt.txt'), PROMPT, 'utf-8');
// A run that produced output but predates prompt recording.
writeFileSync(
  path.join(outputs, 'run_legacy.jsonl'),
  '{"ts":"2026-01-01T00:00:00.000Z","stream":"stdout","text":"hi"}\n',
  'utf-8',
);

const { GET } = await import('./route');

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const get = (id: string) =>
  GET(new Request(`http://x/api/runs/${id}/prompt`), { params: Promise.resolve({ id }) });

describe('GET /api/runs/:id/prompt', () => {
  it('serves the recorded prompt verbatim', async () => {
    const res = await get('run_recorded');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { prompt: string }).prompt).toBe(PROMPT);
  });

  it('404s `no prompt recorded` for a run from before prompts were kept', async () => {
    // Migration tolerance: an old run is not an error, it just has no prompt.
    const res = await get('run_legacy');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe('no prompt recorded');
  });

  it('404s an id nothing has ever heard of', async () => {
    const res = await get('run_nope');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe('no prompt recorded');
  });

  it('cannot be walked out of the outputs directory', async () => {
    // The id becomes a filename. `../../` must not reach a real file — and the
    // sanitized name must not accidentally hit the recorded one either.
    const res = await get('../../../../etc/passwd');
    expect(res.status).toBe(404);
  });
});
