import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ProviderStreamItem, ProviderTurn } from '@ligma/core/agent';
/**
 * The composer's three additions, end to end through a real turn: a reference
 * image reaches the model as an image block, an `@`-mention is staged as a
 * frozen copy the turn can actually read, and the user's message says which
 * images came with it.
 *
 * Stubbed provider, real routes, real registry, real transcript — the same
 * seam `integration/studio-transcript.test.ts` uses. No model runs.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DaemonRequest } from '../../src/http';
import { CENTRAL_PROJECTS_DIR } from '../../src/paths';
import { mutateProjects } from '../../src/store/data';
import { type StudioFrame, subscribeStudio } from '../../src/studio/events';
import { type StudioTurnRequest, setStudioProvider } from '../../src/studio/provider';
import { readTurnTranscript } from '../../src/studio/turn-transcript';

import * as designsRoute from '../../src/routes/projects/_id/designs/route';

const projectId = `test_composer_turn_${Date.now()}`;
const frames: StudioFrame[] = [];
let unsubscribe: (() => void) | undefined;
let designId = '';
let previousProvider: ReturnType<typeof setStudioProvider>;
let skills: string;
const realSkillsDir = process.env.LIGMA_SKILLS_DIR;

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** What the provider was handed — the whole point of the test. */
let seen: {
  prompt: string;
  images: StudioTurnRequest['images'];
  hasSkillTool: boolean;
  stagedBody: string | null;
} | null = null;

function stream(...items: ProviderStreamItem[]): ProviderTurn {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

const stubProvider = async (request: StudioTurnRequest): Promise<ProviderTurn> => {
  if (request.registry.has('submit_critique')) return stream({ type: 'done', stopReason: 'stop' });

  const tool = request.registry.get('read_staged_skill');
  const read = tool
    ? await tool.run({ path: 'ref-skill/SKILL.md' }, { signal: new AbortController().signal })
    : null;
  seen = {
    prompt: request.prompt,
    images: request.images,
    hasSkillTool: request.registry.has('read_staged_skill'),
    stagedBody: read?.ok === true ? String(read.result) : null,
  };

  return stream(
    {
      type: 'tool_call_batch',
      calls: [
        { id: 'w1', name: 'write_file', input: { path: 'index.html', content: '<h1>hi</h1>' } },
      ],
    },
    { type: 'done', stopReason: 'stop' },
  );
};

async function waitForTurn(turnId: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (
      frames.some(
        (f) => f.event === 'design.turn-done' && (f.data as { turnId: string }).turnId === turnId,
      )
    )
      return;
    if (Date.now() > deadline) throw new Error(`turn ${turnId} did not finish`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

beforeAll(async () => {
  skills = await mkdtemp(path.join(tmpdir(), 'ligma-composer-turn-skills-'));
  process.env.LIGMA_SKILLS_DIR = skills;
  await mkdir(path.join(skills, 'ref-skill'), { recursive: true });
  await writeFile(
    path.join(skills, 'ref-skill', 'SKILL.md'),
    '---\nname: ref-skill\n---\n\nUse a 4pt grid.\n',
  );

  previousProvider = setStudioProvider(stubProvider);
  await mutateProjects(async (data) => {
    data.projects.push({
      id: projectId,
      name: 'Composer turn',
      description: 'A landing page',
      status: 'active',
    } as unknown as (typeof data.projects)[number]);
  });
});

afterAll(async () => {
  setStudioProvider(previousProvider);
  unsubscribe?.();
  await rm(skills, { recursive: true, force: true });
  await rm(path.join(CENTRAL_PROJECTS_DIR, projectId), { recursive: true, force: true });
  if (realSkillsDir === undefined) delete process.env.LIGMA_SKILLS_DIR;
  else process.env.LIGMA_SKILLS_DIR = realSkillsDir;
});

describe('a turn carrying a reference image and an @-mention', () => {
  it('runs', async () => {
    const response = await designsRoute.POST(
      new DaemonRequest(`http://127.0.0.1/api/projects/${projectId}/designs`, {
        method: 'POST',
        body: JSON.stringify({
          prompt: 'make it look like this, following @ref-skill',
          attachments: [{ name: 'moodboard.png', dataUrl: `data:image/png;base64,${PNG_BASE64}` }],
        }),
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(response.status).toBe(201);
    const created = (await response.json()) as { design: { id: string }; turn: { turnId: string } };
    designId = created.design.id;
    unsubscribe = subscribeStudio(designId, (frame) => frames.push(frame));
    await waitForTurn(created.turn.turnId);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it('put the image in front of the model as an image block', () => {
    expect(seen?.images).toEqual([{ mediaType: 'image/png', base64: PNG_BASE64 }]);
  });

  it('staged the mentioned skill and gave the turn the tool to read it', () => {
    expect(seen?.hasSkillTool).toBe(true);
    expect(seen?.stagedBody).toContain('Use a 4pt grid.');
    expect(seen?.prompt).toContain('read_staged_skill');
    expect(seen?.prompt).toContain('ref-skill/SKILL.md');
  });

  it("echoes the attachment on the user's message", async () => {
    const parts = (await readTurnTranscript(projectId, designId)).map((entry) => entry.part);
    expect(parts).toContainEqual({ kind: 'attachments', names: ['moodboard.png'] });
  });

  it('refuses a turn naming an attachment this design never stored', async () => {
    const turnRoute = await import('../../src/routes/projects/_id/designs/_did/turn/route');
    const response = await turnRoute.POST(
      new DaemonRequest('http://127.0.0.1/x', {
        method: 'POST',
        body: JSON.stringify({ kind: 'prompt', prompt: 'again', attachmentIds: ['nope.png'] }),
      }),
      { params: Promise.resolve({ id: projectId, did: designId }) },
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/Unknown attachment/);
  });
});
