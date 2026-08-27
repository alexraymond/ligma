/**
 * Promote must land tasks a dispatcher can actually pick up. On a greenfield
 * instance the crew is empty, so promote ensures a build agent exists; on a
 * seeded instance it reuses the crew rather than inventing a duplicate.
 */

import { mkdtempSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-builder-agent-'));
process.env.LIGMA_DATA_DIR = dataDir;

const { ensureBuilderAgent } = await import('../src/store/data');

afterAll(async () => {
  await import('node:fs/promises').then((fs) => fs.rm(dataDir, { recursive: true, force: true }));
});

describe('ensureBuilderAgent', () => {
  it('creates a default builder on an empty crew and is idempotent', async () => {
    const first = await ensureBuilderAgent();
    expect(first).toBe('builder');

    const file = JSON.parse(await readFile(path.join(dataDir, 'agents.json'), 'utf-8')) as {
      agents: Array<{ id: string; status: string; instructions: string }>;
    };
    expect(file.agents).toHaveLength(1);
    expect(file.agents[0]?.status).toBe('active');
    // The builder must not be told to teach to the test.
    expect(file.agents[0]?.instructions).toContain('held-out');

    const second = await ensureBuilderAgent();
    expect(second).toBe('builder');
    const again = JSON.parse(await readFile(path.join(dataDir, 'agents.json'), 'utf-8')) as {
      agents: unknown[];
    };
    expect(again.agents).toHaveLength(1);
  });

  it('prefers an existing active non-me agent over inventing one', async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(
      path.join(dataDir, 'agents.json'),
      JSON.stringify({
        agents: [
          { id: 'me', name: 'Me', status: 'active' },
          { id: 'dev', name: 'Developer', status: 'active' },
          { id: 'builder', name: 'Builder', status: 'active' },
        ],
      }),
    );
    expect(await ensureBuilderAgent()).toBe('dev');
  });
});
