import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { DesignTranscriptEntry } from '@ligma/api';
import type { ProviderStreamItem, ProviderTurn } from '@ligma/core/agent';
/**
 * `session.ts` used to iterate the agent stream and drop everything except
 * `turn_done` — text, thinking and every tool event vanished, and the manifest
 * had nowhere to put them. This is the test that the turn now leaves a
 * transcript behind: the model's prose, its thinking, its tool calls with
 * their outcome, the files it produced, and how the turn ended.
 *
 * Stubbed provider, real agent loop, real tool registry — the same seam
 * `integration/studio-session.test.ts` uses.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DaemonRequest } from '../../src/http';
import { CENTRAL_PROJECTS_DIR } from '../../src/paths';
import { mutateProjects } from '../../src/store/data';
import { type StudioFrame, subscribeStudio } from '../../src/studio/events';
import { type StudioTurnRequest, setStudioProvider } from '../../src/studio/provider';
import { readTurnTranscript } from '../../src/studio/turn-transcript';

import * as transcriptRoute from '../../src/routes/projects/_id/designs/_did/transcript/route';
import * as designsRoute from '../../src/routes/projects/_id/designs/route';

const projectId = `test_transcript_session_${Date.now()}`;
const frames: StudioFrame[] = [];
let unsubscribe: (() => void) | undefined;
let designId = '';
let previousProvider: ReturnType<typeof setStudioProvider>;

function stream(...items: ProviderStreamItem[]): ProviderTurn {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

const stubProvider = async (request: StudioTurnRequest): Promise<ProviderTurn> => {
  if (request.registry.has('submit_critique')) {
    return stream({ type: 'done', stopReason: 'stop' });
  }
  return stream(
    { type: 'thinking', delta: 'One screen, centred, nothing else.' },
    { type: 'text', delta: 'Writing the landing page.' },
    {
      type: 'tool_call_batch',
      calls: [
        { id: 'w1', name: 'write_file', input: { path: 'index.html', content: '<h1>hello</h1>' } },
      ],
    },
    { type: 'text', delta: ' Done.' },
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
  previousProvider = setStudioProvider(stubProvider);
  await mutateProjects(async (data) => {
    data.projects.push({
      id: projectId,
      name: 'Transcript session',
      description: 'A landing page',
      status: 'active',
    } as unknown as (typeof data.projects)[number]);
  });
});

afterAll(async () => {
  setStudioProvider(previousProvider);
  unsubscribe?.();
  await rm(path.join(CENTRAL_PROJECTS_DIR, projectId), { recursive: true, force: true });
});

describe('a generation turn records its transcript', () => {
  it('persists the user prompt, the prose, the thinking, the tool call and the files', async () => {
    const response = await designsRoute.POST(
      new DaemonRequest(`http://127.0.0.1/api/projects/${projectId}/designs`, {
        method: 'POST',
        body: JSON.stringify({ prompt: 'a single centered hello-world landing page' }),
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    const created = (await response.json()) as { design: { id: string }; turn: { turnId: string } };
    designId = created.design.id;
    unsubscribe = subscribeStudio(designId, (frame) => frames.push(frame));
    await waitForTurn(created.turn.turnId);
    // `finish` settles just after turn-done is emitted; give the chain a tick.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const entries = await readTurnTranscript(projectId, designId);
    const parts = entries.map((e) => e.part);

    expect(entries[0]!.role).toBe('user');
    expect((entries[0]?.part as { text: string }).text).toBe(
      'a single centered hello-world landing page',
    );
    expect(
      parts.filter((p) => p.kind === 'thinking').map((p) => (p as { text: string }).text),
    ).toEqual(['One screen, centred, nothing else.']);
    expect(
      parts
        .filter((p) => p.kind === 'text' && p !== parts[0])
        .map((p) => (p as { text: string }).text)
        .join(''),
    ).toBe('Writing the landing page. Done.');
    expect(parts.filter((p) => p.kind === 'tool')).toEqual([
      {
        kind: 'tool',
        toolUseId: 'w1',
        toolName: 'write_file',
        summary: 'index.html',
        status: 'running',
      },
      {
        kind: 'tool',
        toolUseId: 'w1',
        toolName: 'write_file',
        summary: 'index.html',
        status: 'ok',
      },
    ]);
    expect(parts.filter((p) => p.kind === 'files')).toEqual([
      { kind: 'files', paths: ['index.html'] },
    ]);
    expect(parts.at(-1)).toEqual({ kind: 'done', stopReason: 'stop', error: null });
  });

  it('forwarded every entry live on the existing studio SSE channel', () => {
    const forwarded = frames
      .filter((f) => f.event === 'design.transcript')
      .map((f) => f.data as DesignTranscriptEntry);
    expect(forwarded.length).toBeGreaterThan(0);
    expect(forwarded.every((e) => e.turnId !== '' && e.designId === designId)).toBe(true);
  });

  it('serves the transcript back for a reload', async () => {
    const response = await transcriptRoute.GET(new DaemonRequest('http://127.0.0.1/x'), {
      params: Promise.resolve({ id: projectId, did: designId }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { designId: string; entries: DesignTranscriptEntry[] };
    expect(body.designId).toBe(designId);
    expect(body.entries).toEqual(await readTurnTranscript(projectId, designId));
  });

  it('404s a design that does not exist rather than serving an empty transcript', async () => {
    const response = await transcriptRoute.GET(new DaemonRequest('http://127.0.0.1/x'), {
      params: Promise.resolve({ id: projectId, did: 'd_nope' }),
    });
    expect(response.status).toBe(404);
  });
});
