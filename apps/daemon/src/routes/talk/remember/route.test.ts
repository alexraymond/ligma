import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dataDir: string;
let repoDir: string;
let previousData: string | undefined;
let project: { id: string; name: string; repoPath: string | null } | null;

vi.mock('../../projects/_id/_lib', () => ({
  findProject: async () => project,
  badRequest: (err: unknown) =>
    new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 400,
    }),
}));

beforeEach(() => {
  previousData = process.env.LIGMA_DATA_DIR;
  dataDir = mkdtempSync(path.join(tmpdir(), 'ligma-talk-remember-'));
  repoDir = mkdtempSync(path.join(tmpdir(), 'ligma-talk-repo-'));
  process.env.LIGMA_DATA_DIR = dataDir;
  project = { id: 'proj_a', name: 'P', repoPath: repoDir };
  vi.resetModules();
});

afterEach(() => {
  if (previousData === undefined) delete process.env.LIGMA_DATA_DIR;
  else process.env.LIGMA_DATA_DIR = previousData;
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(repoDir, { recursive: true, force: true });
});

function remember(body: unknown) {
  return import('./route').then(({ POST }) =>
    POST(
      new Request('http://localhost/x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: 'proj_a' }) },
    ),
  );
}

async function seedMessage(body: string): Promise<string> {
  const { appendTalkMessage } = await import('../store');
  return (await appendTalkMessage('proj_a', { author: 'you', body })).id;
}

describe('POST /api/projects/:id/talk/remember', () => {
  it('lands the message body in .ligma/project.md under Quirks', async () => {
    const messageId = await seedMessage('Never run the seed twice — it double-books every slot.');
    const res = await remember({ messageId });
    expect(res.status).toBe(200);
    expect((await res.json()) as { landedIn: string }).toMatchObject({
      landedIn: '.ligma/project.md → Quirks',
    });

    const projectMd = readFileSync(path.join(repoDir, '.ligma', 'project.md'), 'utf-8');
    expect(projectMd).toContain('## Quirks');
    expect(projectMd).toContain('Never run the seed twice — it double-books every slot.');
  });

  it('appends a second quirk under the same section', async () => {
    const first = await seedMessage('first quirk');
    const second = await seedMessage('second quirk');
    await remember({ messageId: first });
    await remember({ messageId: second });

    const projectMd = readFileSync(path.join(repoDir, '.ligma', 'project.md'), 'utf-8');
    expect(projectMd.match(/## Quirks/g)).toHaveLength(1);
    expect(projectMd.indexOf('first quirk')).toBeLessThan(projectMd.indexOf('second quirk'));
  });

  it('409s with a plain reason when the project has no repo', async () => {
    const messageId = await seedMessage('worth remembering');
    project = { id: 'proj_a', name: 'P', repoPath: null };
    const res = await remember({ messageId });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/no repo/i);
  });

  it('404s for a project that does not exist', async () => {
    project = null;
    expect((await remember({ messageId: 'talk_x' })).status).toBe(404);
  });

  it("404s for a message that is not in this project's thread", async () => {
    await seedMessage('something else');
    const res = await remember({ messageId: 'talk_nope' });
    expect(res.status).toBe(404);
  });

  it('400s without a messageId', async () => {
    expect((await remember({})).status).toBe(400);
  });
});
