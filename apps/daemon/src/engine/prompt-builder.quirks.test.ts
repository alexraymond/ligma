import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
/**
 * Quirks injection — UX spec §16 claims "project memory, which planning already
 * injects". It did not until this section existed; this is the test that keeps
 * the claim true.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dataDir: string;
let repoDir: string;
let previousData: string | undefined;

function seed(name: string, value: unknown): void {
  writeFileSync(path.join(dataDir, name), JSON.stringify(value, null, 2), 'utf-8');
}

const TASK = {
  id: 'task_1',
  title: 'Add the export button',
  description: '',
  importance: 'important',
  urgency: 'urgent',
  kanban: 'not-started',
  assignedTo: 'developer',
  projectId: 'proj_a',
  collaborators: [],
  subtasks: [],
  acceptanceCriteria: [],
  notes: '',
  estimatedMinutes: null,
};

beforeEach(() => {
  previousData = process.env.LIGMA_DATA_DIR;
  dataDir = mkdtempSync(path.join(tmpdir(), 'ligma-quirks-prompt-'));
  repoDir = mkdtempSync(path.join(tmpdir(), 'ligma-quirks-repo-'));
  process.env.LIGMA_DATA_DIR = dataDir;
  seed('projects.json', {
    projects: [{ id: 'proj_a', name: 'P', repoPath: repoDir, deletedAt: null }],
  });
  seed('agents.json', {
    agents: [
      {
        id: 'developer',
        name: 'Dev',
        description: 'Builds.',
        instructions: '',
        capabilities: [],
        skillIds: [],
      },
    ],
  });
  seed('skills-library.json', { skills: [] });
  seed('tasks.json', { tasks: [TASK] });
  vi.resetModules();
});

afterEach(() => {
  if (previousData === undefined) delete process.env.LIGMA_DATA_DIR;
  else process.env.LIGMA_DATA_DIR = previousData;
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(repoDir, { recursive: true, force: true });
});

async function promptFor(): Promise<string> {
  const { buildTaskPrompt } = await import('./prompt-builder');
  return buildTaskPrompt('developer', TASK as never);
}

describe('buildTaskPrompt — project quirks', () => {
  it("injects the repo's Quirks section under its own heading", async () => {
    const { appendQuirk } = await import('../store/ligma-dir');
    appendQuirk(repoDir, 'The dev server needs two starts on a cold cache.');

    const prompt = await promptFor();
    expect(prompt).toContain('## Project quirks (owner-taught)');
    expect(prompt).toContain('The dev server needs two starts on a cold cache.');
  });

  it('omits the section entirely when the repo has recorded no quirks', async () => {
    expect(await promptFor()).not.toContain('## Project quirks (owner-taught)');
  });

  it('omits the section for a project with no repo', async () => {
    seed('projects.json', {
      projects: [{ id: 'proj_a', name: 'P', repoPath: null, deletedAt: null }],
    });
    vi.resetModules();
    expect(await promptFor()).not.toContain('## Project quirks (owner-taught)');
  });

  it('keeps the newest quirks when the section outgrows the cap', async () => {
    const { appendQuirk } = await import('../store/ligma-dir');
    appendQuirk(repoDir, 'x'.repeat(3000));
    appendQuirk(repoDir, 'THE-NEWEST-QUIRK');

    const prompt = await promptFor();
    const section = prompt.slice(
      prompt.indexOf('## Project quirks (owner-taught)'),
      prompt.indexOf('## Standard Operating Procedures'),
    );
    expect(section).toContain('THE-NEWEST-QUIRK');
    // Truncated from the front — the elision marker is the honest signal.
    expect(section).toContain('…');
    expect(section.length).toBeLessThan(2600);
  });
});
