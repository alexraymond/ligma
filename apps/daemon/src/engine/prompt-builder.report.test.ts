import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
/**
 * The builder's final report contract — what it MUST say when it stops, and what
 * we say when it says nothing.
 *
 * The live incident this pins: a builder that had written a whole paper/ and
 * code/ tree completed with a report reading "No additional notes.". Two halves
 * to that — the SOP never asked for a summary at all (only `completedSubtaskIds`,
 * and only when the task had subtasks), and the dispatcher passed the empty
 * string straight into the completion handler. So the contract is required here,
 * and a missing summary is now named as missing rather than dressed up as
 * "nothing to report".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dataDir: string;
let previousData: string | undefined;
let previousOutputs: string | undefined;

function seed(name: string, value: unknown): void {
  writeFileSync(path.join(dataDir, name), JSON.stringify(value, null, 2), 'utf-8');
}

const TASK = {
  id: 'task_1',
  title: 'Write the paper',
  description: '',
  importance: 'important',
  urgency: 'urgent',
  kanban: 'not-started',
  assignedTo: 'developer',
  projectId: null,
  collaborators: [],
  subtasks: [] as Array<{ id: string; title: string; done: boolean }>,
  acceptanceCriteria: [],
  notes: '',
  estimatedMinutes: null,
};

/** stdout as the CLI really hands it back: the reply wrapped in a result event. */
function cliStdout(reply: string): string {
  return JSON.stringify([{ type: 'result', result: reply }]);
}

beforeEach(() => {
  previousData = process.env.LIGMA_DATA_DIR;
  previousOutputs = process.env.MC_RUN_OUTPUTS_DIR;
  dataDir = mkdtempSync(path.join(tmpdir(), 'ligma-report-prompt-'));
  process.env.LIGMA_DATA_DIR = dataDir;
  process.env.MC_RUN_OUTPUTS_DIR = path.join(dataDir, 'run-outputs');
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
  if (previousOutputs === undefined) delete process.env.MC_RUN_OUTPUTS_DIR;
  else process.env.MC_RUN_OUTPUTS_DIR = previousOutputs;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('buildTaskPrompt — the final report block', () => {
  it('requires summary and artifacts even when the task has no subtasks', async () => {
    const { buildTaskPrompt } = await import('./prompt-builder');
    const prompt = buildTaskPrompt('developer', TASK as never);

    expect(prompt).toContain('## Final Report (required)');
    expect(prompt).toContain('"summary"');
    expect(prompt).toContain('"artifacts"');
    // No subtasks on this task: nothing to report, so the key is not demanded.
    expect(prompt).not.toContain('"completedSubtaskIds"');
  });

  it('adds completedSubtaskIds to the same block when the task has subtasks', async () => {
    seed('tasks.json', {
      tasks: [{ ...TASK, subtasks: [{ id: 'st_1', title: 'Draft', done: false }] }],
    });
    vi.resetModules();
    const { buildTaskPrompt, getTask } = await import('./prompt-builder');
    const prompt = buildTaskPrompt('developer', getTask('task_1') as never);

    expect(prompt).toContain('## Final Report (required)');
    expect(prompt).toContain('"completedSubtaskIds"');
  });
});

describe('parseBuilderReport', () => {
  it('reads summary, artifacts and subtask ids out of the fenced block', async () => {
    const { parseBuilderReport } = await import('./prompt-builder');
    const report = parseBuilderReport(
      cliStdout(
        'Done.\n\n```json\n{"summary":"Wrote the paper and the training code.","artifacts":["paper/draft.md","code/train.py"],"completedSubtaskIds":["st_1"]}\n```',
      ),
    );

    expect(report.summary).toBe('Wrote the paper and the training code.');
    expect(report.artifacts).toEqual(['paper/draft.md', 'code/train.py']);
    expect(report.completedSubtaskIds).toEqual(['st_1']);
  });

  it('is empty, never a throw, when the builder emitted no block at all', async () => {
    const { parseBuilderReport } = await import('./prompt-builder');
    expect(parseBuilderReport(cliStdout('all done!'))).toEqual({
      summary: '',
      artifacts: [],
      completedSubtaskIds: [],
    });
  });

  it('keeps parseCompletedSubtaskIds working on the same block', async () => {
    const { parseCompletedSubtaskIds } = await import('./prompt-builder');
    expect(
      parseCompletedSubtaskIds(
        cliStdout('```json\n{"completedSubtaskIds":["st_1","st_1"," st_2 ",""]}\n```'),
      ),
    ).toEqual(['st_1', 'st_2']);
  });
});

describe('recordBuilderReport', () => {
  const LOG = '/tmp/run-outputs/run_1.jsonl';

  it('names a missing summary as missing, with the log to go read', async () => {
    const { recordBuilderReport } = await import('./prompt-builder');
    const { body, report } = recordBuilderReport({
      runId: 'run_1',
      stdout: cliStdout('I finished.'),
      outputLogPath: LOG,
    });

    expect(body).toBe(`Builder returned no summary — see run output log ${LOG}`);
    expect(body).not.toContain('No additional notes');
    expect(report.summary).toBe('');
  });

  it('puts the artifacts under the summary so the file output is visible', async () => {
    const { recordBuilderReport } = await import('./prompt-builder');
    const { body } = recordBuilderReport({
      runId: 'run_2',
      stdout: cliStdout(
        '```json\n{"summary":"Wrote the paper.","artifacts":["paper/draft.md"]}\n```',
      ),
      outputLogPath: LOG,
    });

    expect(body).toContain('Wrote the paper.');
    expect(body).toContain('paper/draft.md');
  });

  it("falls back to the CLI's own result text before claiming there is no summary", async () => {
    const { recordBuilderReport } = await import('./prompt-builder');
    const { body } = recordBuilderReport({
      runId: 'run_3',
      stdout: cliStdout('I refactored the loader.'),
      outputLogPath: LOG,
      fallbackSummary: 'I refactored the loader.',
    });

    expect(body).toBe('I refactored the loader.');
  });

  it("persists summary and artifacts beside the run's output, for the outcome route to read", async () => {
    const { recordBuilderReport } = await import('./prompt-builder');
    recordBuilderReport({
      runId: 'run_4',
      stdout: cliStdout('```json\n{"summary":"Shipped.","artifacts":["code/train.py"]}\n```'),
      outputLogPath: LOG,
    });

    const file = path.join(dataDir, 'run-outputs', 'run_4.report.json');
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toMatchObject({
      summary: 'Shipped.',
      artifacts: ['code/train.py'],
    });
  });
});
