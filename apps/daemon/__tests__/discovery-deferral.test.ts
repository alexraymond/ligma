/**
 * Discovery answers a governor denial; it does not wait one out.
 *
 * The sibling of `promote-preview-honesty.test.ts`, and the second half of
 * d1-attempt-1's blockers: `POST /api/briefs` failed 3/3 for the spec-auditor
 * with nothing on screen to act on. Both brief entrances are HTTP requests the
 * browser holds open, so claiming a slot used to mean blocking them for up to
 * twenty minutes — past even the web proxy's ceiling — for a decision the
 * governor had already made.
 *
 * Now the claim is immediate and the denial comes back as the structured
 * deferral the brief thread renders: the saved brief, the message, and a
 * `causeKind`/`resumesAt` pair the failure-card family maps to a calm card with
 * a retry. No model spawns: the denial happens before `AgentRunner` is reached,
 * and the success path runs on the discovery stub.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Brief } from '@ligma/api';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { GovernorDecision } from '../src/engine/quota-governor';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-discovery-defer-'));
process.env.LIGMA_DATA_DIR = dataDir;

const PROJECT_ID = 'proj_discovery_defer';

mkdirSync(dataDir, { recursive: true });
writeFileSync(
  path.join(dataDir, 'projects.json'),
  JSON.stringify({
    projects: [
      {
        id: PROJECT_ID,
        name: 'Deferred',
        description: '',
        status: 'active',
        color: '#000',
        teamMembers: [],
        createdAt: '2026-08-12T00:00:00.000Z',
        tags: [],
        deletedAt: null,
        repoPath: null,
      },
    ],
  }),
  'utf-8',
);
for (const [file, empty] of Object.entries({
  'tasks.json': { tasks: [] },
  'goals.json': { goals: [] },
  'decisions.json': { decisions: [] },
  'activity-log.json': { events: [] },
})) {
  writeFileSync(path.join(dataDir, file), JSON.stringify(empty), 'utf-8');
}

/** What `claimSpawn` answers next. The real ledger is never touched. */
const decision: GovernorDecision = {
  allowed: false,
  reason: 'reserve',
  retryInMs: 90_000,
  backend: 'claude',
};

vi.mock('../src/engine/quota-governor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/engine/quota-governor')>();
  // `deferralFields` and `GovernorAbort` stay real — turning a denial into
  // {causeKind, resumesAt} is exactly what is under test.
  return { ...actual, claimSpawn: () => decision };
});

const { createApp } = await import('../src/server');
const { newBrief, writeBrief, readBrief } = await import('../src/engine/discovery');

interface DiscoveryFailureBody {
  brief?: Brief;
  error?: string;
  causeKind?: string;
  resumesAt?: string | null;
}

let base: string;
let server: ReturnType<ReturnType<typeof createApp>['listen']>;

beforeAll(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.LIGMA_DISCOVERY_STUB;
});

describe('a governor denial reaches the brief thread as a deferral', () => {
  it('answers POST /api/briefs immediately, keeping the project and its brief', async () => {
    const started = Date.now();
    const res = await fetch(`${base}/api/briefs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'A REST API that shortens URLs, with rate limiting.' }),
    });
    const body = (await res.json()) as DiscoveryFailureBody;

    expect(res.status).toBe(502);
    expect(body.causeKind).toBe('rate-limit');
    expect(Date.parse(body.resumesAt ?? '')).toBeGreaterThan(started);
    expect(body.error).toContain('reserve');
    // The blocker d1 actually hit: the project existed but had no brief to
    // return to. The draft is saved and handed back, so the thread has one.
    expect(body.brief?.prompt).toContain('shortens URLs');
    expect(readBrief(body.brief!.projectId)).not.toBeNull();
    // The old path blocked for twenty minutes here.
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('answers the answers POST the same way, with the answers already saved', async () => {
    const draft = writeBrief(newBrief(PROJECT_ID, 'A REST API', null));
    draft.turns.push({
      form: {
        id: 'frm_1',
        title: 'A few questions',
        description: '',
        questions: [
          {
            id: 'audience',
            label: 'Who is this for?',
            type: 'text',
            options: [],
            required: true,
            help: '',
          },
        ],
      },
      answers: null,
      askedAt: new Date().toISOString(),
      answeredAt: null,
    });
    writeBrief(draft);

    const res = await fetch(`${base}/api/projects/${PROJECT_ID}/brief/answers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ formId: 'frm_1', answers: { audience: 'Developers' } }),
    });
    const body = (await res.json()) as DiscoveryFailureBody;

    expect(res.status).toBe(502);
    expect(body.causeKind).toBe('rate-limit');
    expect(body.resumesAt).toBeTruthy();
    // Answering twice into the void is what made d1's personas re-do rounds.
    expect(readBrief(PROJECT_ID)?.turns[0].answers).toEqual({ audience: 'Developers' });
  });

  it('leaves the success path exactly as it was — no cause on a brief that ran', async () => {
    process.env.LIGMA_DISCOVERY_STUB = '1';
    try {
      const res = await fetch(`${base}/api/briefs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'A CLI that renames files.' }),
      });
      const body = (await res.json()) as DiscoveryFailureBody;

      expect(res.status).toBe(201);
      expect(body.error).toBeUndefined();
      expect(body.causeKind).toBeUndefined();
      expect(body.brief?.turns).toHaveLength(1);
    } finally {
      delete process.env.LIGMA_DISCOVERY_STUB;
    }
  });
});
