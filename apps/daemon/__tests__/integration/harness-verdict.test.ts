/**
 * Integration: applyVerdict is the only door to "done", and the feedback loop.
 *
 * Runs against the real data files (the integration setup backs them up and
 * restores them afterwards). No LLM and no ephemeral env: verdicts are written
 * to disk directly, which is exactly what the judge would have produced.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTaskPrompt } from '../../src/engine/prompt-builder';
import { saveContract } from '../../src/harness/contract-store';
import type { CriterionVerdict, VerificationVerdict } from '../../src/harness/types';
import {
  RUNS_DIR,
  appendHumanDecisions,
  applyVerdict,
  getLatestFailedVerdict,
} from '../../src/harness/verdict';
import { getActivityLog, getDecisions, getInbox, getTasks, saveTasks } from '../../src/store/data';
import { createTask, findTask } from './test-utils';

import { DATA_DIR } from '../../src/paths';
const CONTRACTS_DIR = path.join(DATA_DIR, 'contracts');
const createdRunDirs: string[] = [];
const createdContracts: string[] = [];

function writeVerdict(verdict: VerificationVerdict): void {
  const runDir = path.join(RUNS_DIR, verdict.runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    path.join(runDir, 'run.json'),
    JSON.stringify({ id: verdict.runId, taskId: verdict.taskId, status: 'complete' }, null, 2),
    'utf-8',
  );
  writeFileSync(path.join(runDir, 'verdict.json'), JSON.stringify(verdict, null, 2), 'utf-8');
  createdRunDirs.push(runDir);
}

function verdictFor(
  taskId: string,
  outcome: 'passed' | 'failed',
  criterionVerdicts: CriterionVerdict[],
  over: Partial<VerificationVerdict> = {},
): VerificationVerdict {
  return {
    runId: `vrun_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    taskId,
    contractId: 'ctr_test',
    contractVersion: 1,
    outcome,
    criterionVerdicts,
    humanDecisions: [],
    judgeModel: 'opus',
    createdAt: new Date().toISOString(),
    signature: null,
    ...over,
  };
}

const met = (id: string): CriterionVerdict => ({
  criterionId: id,
  status: 'met',
  reasoning: 'spec-auditor observed it',
  evidence: [`personas/spec-auditor/shots/01-criterion-${id}.png`],
});

beforeAll(() => {
  mkdirSync(RUNS_DIR, { recursive: true });
});

afterAll(() => {
  for (const dir of createdRunDirs) rmSync(dir, { recursive: true, force: true });
  for (const file of createdContracts) rmSync(file, { force: true });
});

describe('applyVerdict — passed', () => {
  it('is the path that writes kanban done, with verificationStatus and completedAt', async () => {
    const task = await createTask({
      kanban: 'awaiting-verification',
      verificationStatus: 'unverified',
      assignedTo: 'developer',
    });
    await applyVerdict(verdictFor(task.id, 'passed', [met('crit_1')]));

    const after = await findTask(task.id);
    expect(after?.kanban).toBe('done');
    expect(after?.verificationStatus).toBe('passed');
    expect(after?.completedAt).toBeTruthy();
  });

  it('unblocks dependents of the newly-done task', async () => {
    const blocker = await createTask({
      kanban: 'awaiting-verification',
      verificationStatus: 'unverified',
    });
    const dependent = await createTask({ blockedBy: [blocker.id], assignedTo: 'developer' });
    const unrelated = await createTask({
      blockedBy: ['task_never_done_999'],
      assignedTo: 'developer',
    });

    await applyVerdict(verdictFor(blocker.id, 'passed', [met('crit_1')]));

    // Unblocked because the blocker is now done — the declared dependency stays
    // on the task, because a pruned array can never say "blocked again" (M5).
    const { isTaskUnblocked } = await import('../../src/engine/prompt-builder');
    expect((await findTask(dependent.id))?.blockedBy).toEqual([blocker.id]);
    expect(isTaskUnblocked((await findTask(dependent.id)) as never)).toBe(true);
    // A blocker that is not done must still block.
    expect((await findTask(unrelated.id))?.blockedBy).toEqual(['task_never_done_999']);
    expect(isTaskUnblocked((await findTask(unrelated.id)) as never)).toBe(false);
  });

  it('logs task_completed and reports to the inbox', async () => {
    const task = await createTask({
      kanban: 'awaiting-verification',
      verificationStatus: 'unverified',
      assignedTo: 'developer',
    });
    await applyVerdict(verdictFor(task.id, 'passed', [met('crit_1')]));

    const events = (await getActivityLog()).events.filter((e) => e.taskId === task.id);
    expect(events.some((e) => e.type === 'task_completed')).toBe(true);

    const messages = (await getInbox()).messages.filter((m) => m.taskId === task.id);
    expect(messages.some((m) => m.subject.startsWith('Verified:'))).toBe(true);
  });
});

describe('applyVerdict — failed', () => {
  it('re-queues the builder and never writes done', async () => {
    const task = await createTask({
      kanban: 'awaiting-verification',
      verificationStatus: 'unverified',
      assignedTo: 'developer',
    });
    await applyVerdict(
      verdictFor(task.id, 'failed', [
        {
          criterionId: 'crit_1',
          status: 'not-met',
          reasoning: 'the note was empty on reopen',
          evidence: ['personas/spec-auditor/shots/03-click.png'],
        },
      ]),
    );

    const after = await findTask(task.id);
    expect(after?.kanban).toBe('not-started');
    expect(after?.verificationStatus).toBe('failed');
    expect(after?.completedAt).toBeNull();
  });

  it('does not unblock dependents', async () => {
    const blocker = await createTask({
      kanban: 'awaiting-verification',
      verificationStatus: 'unverified',
    });
    const dependent = await createTask({ blockedBy: [blocker.id] });

    await applyVerdict(
      verdictFor(blocker.id, 'failed', [
        { criterionId: 'crit_1', status: 'unknown', reasoning: 'no evidence', evidence: [] },
      ]),
    );

    expect((await findTask(dependent.id))?.blockedBy).toEqual([blocker.id]);
  });

  it('reports every failed criterion with its evidence paths', async () => {
    const task = await createTask({
      kanban: 'awaiting-verification',
      verificationStatus: 'unverified',
      assignedTo: 'developer',
    });
    await applyVerdict(
      verdictFor(task.id, 'failed', [
        met('crit_1'),
        {
          criterionId: 'crit_2',
          status: 'not-met',
          reasoning: 'the notes field came back blank',
          evidence: ['personas/spec-auditor/shots/05-click.png'],
        },
        {
          criterionId: 'inv_1',
          status: 'unknown',
          reasoning: 'the saboteur never reached this',
          evidence: [],
        },
      ]),
    );

    const message = (await getInbox()).messages.filter((m) => m.taskId === task.id).at(-1);
    expect(message?.subject).toMatch(/^Verification failed:/);
    expect(message?.body).toContain('crit_2');
    expect(message?.body).toContain('personas/spec-auditor/shots/05-click.png');
    expect(message?.body).toContain('inv_1');
    // A met criterion is not listed as a failure.
    expect(message?.body).not.toContain('[met]');

    const events = (await getActivityLog()).events.filter((e) => e.taskId === task.id);
    expect(events.some((e) => e.type === 'task_completed')).toBe(false);
  });

  it('does not resurrect a task that was deleted mid-run', async () => {
    const task = await createTask({ kanban: 'awaiting-verification' });
    const data = await getTasks();
    data.tasks = data.tasks.filter((t) => t.id !== task.id);
    await saveTasks(data);

    await expect(
      applyVerdict(verdictFor(task.id, 'passed', [met('crit_1')])),
    ).resolves.toBeUndefined();
    expect(await findTask(task.id)).toBeUndefined();
  });
});

describe('human decisions', () => {
  it('become non-blocking decision cards', async () => {
    const task = await createTask({ kanban: 'awaiting-verification' });
    const verdict = verdictFor(task.id, 'passed', [met('crit_1')], {
      humanDecisions: [
        {
          question: 'Saving works but takes six clicks — accept?',
          context: 'naive-user-2 gave up twice',
        },
      ],
    });

    expect(await appendHumanDecisions(verdict)).toBe(1);

    const card = (await getDecisions()).decisions.filter((d) => d.taskId === task.id).at(-1);
    expect(card?.question).toMatch(/six clicks/);
    expect(card?.status).toBe('pending');
    // Non-blocking: the task's fate is already decided, this is only advice.
    expect(card?.blocksTask).toBe(false);
  });
});

describe('verification feedback reaches the next build prompt', () => {
  it("injects the failed verdict's own reasoning into buildTaskPrompt", async () => {
    const task = await createTask({
      title: 'Capture a task with notes',
      description: 'Notes typed into a task must still be there when it is reopened',
      assignedTo: 'developer',
      acceptanceCriteria: [
        'A task created with notes shows those notes when reopened',
        'The task appears on the board immediately',
      ],
    });

    const contract = saveContract({
      taskId: task.id,
      productId: null,
      title: task.title,
      baselineRunId: null,
      criteria: [
        {
          id: 'crit_1',
          kind: 'criterion',
          text: 'A task created with notes shows those notes when reopened',
          holdout: false,
          provenance: null,
        },
        {
          id: 'crit_2',
          kind: 'criterion',
          text: 'The task appears on the board immediately',
          holdout: true,
          provenance: null,
        },
      ],
    });
    createdContracts.push(path.join(CONTRACTS_DIR, `${task.id}.jsonl`));

    const REASONING =
      'The notes field was blank when the spec-auditor reopened the task it had just created.';
    writeVerdict(
      verdictFor(
        task.id,
        'failed',
        [
          {
            criterionId: 'crit_1',
            status: 'not-met',
            reasoning: REASONING,
            evidence: ['personas/spec-auditor/shots/04-click.png'],
          },
          met('crit_2'),
        ],
        { contractId: contract.id, contractVersion: contract.version },
      ),
    );

    const prompt = buildTaskPrompt('developer', { ...task, tags: task.tags ?? [] });

    // The exact string the judge wrote must survive into the builder's prompt —
    // this is the loop that a regex-based reimplementation silently broke.
    expect(prompt).toContain('## Previous Verification Feedback');
    expect(prompt).toContain(REASONING);
    expect(prompt).toContain('A task created with notes shows those notes when reopened');
    expect(prompt).toContain('personas/spec-auditor/shots/04-click.png');
    // A criterion that passed is not fed back as a failure.
    expect(prompt.split('## Previous Verification Feedback')[1]).not.toContain(
      'appears on the board immediately',
    );
  });

  it('says nothing when the newest verdict passed', async () => {
    const task = await createTask({ title: 'Already verified', assignedTo: 'developer' });
    writeVerdict(
      verdictFor(
        task.id,
        'failed',
        [{ criterionId: 'crit_1', status: 'not-met', reasoning: 'old failure', evidence: [] }],
        {
          createdAt: new Date(Date.now() - 60_000).toISOString(),
        },
      ),
    );
    writeVerdict(verdictFor(task.id, 'passed', [met('crit_1')]));

    expect(getLatestFailedVerdict(task.id)).toBeNull();
    expect(buildTaskPrompt('developer', { ...task, tags: task.tags ?? [] })).not.toContain(
      '## Previous Verification Feedback',
    );
  });

  it('says nothing for a task that has never been verified', async () => {
    const task = await createTask({ title: 'Never verified', assignedTo: 'developer' });
    expect(buildTaskPrompt('developer', { ...task, tags: task.tags ?? [] })).not.toContain(
      '## Previous Verification Feedback',
    );
  });
});
