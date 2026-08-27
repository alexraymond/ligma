import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
/**
 * The decision cards verdict.ts writes and consumes, on the ways they lied.
 *
 * 1. A run the governor denied before a single persona started burned one of the
 *    task's attempts, so tasks hit the cap on quota alone.
 * 2. The "attempts exhausted" card deduped only against PENDING cards, so
 *    answering one made the next poll cycle write another (7-8 per task).
 * 3. Nothing ever consumed an answered card — the four options promised
 *    transitions that never happened.
 * 4. The judge's own questions deduped against nothing at all: 11 near-identical
 *    pending cards from two runs 84s apart, which parked the task (H6).
 *
 * Its sibling defect is at the bottom: "Open a follow-up task" was a dead string
 * on every judge card, offered and never handled (H8).
 *
 * Own data dir, set before the module is imported: DATA_DIR is resolved once at
 * import time (src/paths.ts), so a per-test dir would be ignored.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(path.join(tmpdir(), 'ligma-vcap-'));
process.env.LIGMA_DATA_DIR = dataDir;

const {
  appendHumanDecisions,
  consumeAnsweredCapCards,
  consumeAnsweredFollowUps,
  openDecisionsForTask,
  questionFingerprint,
  refundVerificationAttempt,
  reportVerificationCapReached,
  VERIFICATION_CAP_KIND,
} = await import('./verdict');

const TASKS_FILE = path.join(dataDir, 'tasks.json');
const DECISIONS_FILE = path.join(dataDir, 'decisions.json');

interface TaskFixture {
  id: string;
  title?: string;
  kanban: string;
  verificationStatus?: string;
  verificationAttempts?: number;
  completedAt?: string | null;
  blockedBy?: string[];
  description?: string;
  assignedTo?: string | null;
  projectId?: string | null;
  importance?: string;
  urgency?: string;
}

function writeTasks(tasks: TaskFixture[]): void {
  writeFileSync(TASKS_FILE, JSON.stringify({ tasks }), 'utf-8');
}

function readTasks(): TaskFixture[] {
  return (JSON.parse(readFileSync(TASKS_FILE, 'utf-8')) as { tasks: TaskFixture[] }).tasks;
}

function task(id: string): TaskFixture {
  return readTasks().find((t) => t.id === id)!;
}

function writeDecisions(decisions: Array<Record<string, unknown>>): void {
  writeFileSync(DECISIONS_FILE, JSON.stringify({ decisions }), 'utf-8');
}

function readDecisions(): Array<Record<string, unknown>> {
  return (
    JSON.parse(readFileSync(DECISIONS_FILE, 'utf-8')) as {
      decisions: Array<Record<string, unknown>>;
    }
  ).decisions;
}

/** An answered cap card, as reportVerificationCapReached writes them. */
function capCard(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'dec_cap_1',
    requestedBy: 'system',
    taskId: 'task_1',
    question: 'used all attempts',
    options: [
      'Investigate the harness',
      'Send back to the builder',
      'Accept as is (unverified)',
      'Raise the attempt cap',
    ],
    context: 'verification attempts exhausted: 3/3 runs started, none produced a passing verdict.',
    kind: VERIFICATION_CAP_KIND,
    attempts: 3,
    max: 3,
    status: 'answered',
    answer: 'Investigate the harness',
    answeredAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    blocksTask: false,
    ...over,
  };
}

beforeEach(() => {
  writeTasks([]);
  writeDecisions([]);
  writeFileSync(path.join(dataDir, 'inbox.json'), JSON.stringify({ messages: [] }), 'utf-8');
  writeFileSync(path.join(dataDir, 'activity-log.json'), JSON.stringify({ events: [] }), 'utf-8');
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

// ─── Defect 1 ────────────────────────────────────────────────────────────────

describe('refundVerificationAttempt — a quota denial must not burn an attempt', () => {
  it('gives the attempt back when the run record says the governor denied the panel', async () => {
    writeTasks([{ id: 'task_1', kanban: 'awaiting-verification', verificationAttempts: 2 }]);

    await refundVerificationAttempt('task_1', 'governor-denied');

    expect(task('task_1').verificationAttempts).toBe(1);
  });

  it('keeps the attempt for any other ending — a real run that failed still counts', async () => {
    writeTasks([{ id: 'task_1', kanban: 'awaiting-verification', verificationAttempts: 2 }]);

    await refundVerificationAttempt('task_1', null);

    expect(task('task_1').verificationAttempts).toBe(2);
  });

  it('floors at zero and ignores a task that no longer exists', async () => {
    writeTasks([{ id: 'task_1', kanban: 'awaiting-verification', verificationAttempts: 0 }]);

    await refundVerificationAttempt('task_1', 'governor-denied');
    await refundVerificationAttempt('task_gone', 'governor-denied');

    expect(task('task_1').verificationAttempts).toBe(0);
    expect(readTasks()).toHaveLength(1);
  });
});

// ─── Defect 2 ────────────────────────────────────────────────────────────────

describe('reportVerificationCapReached — one card per exhausted round, not per poll', () => {
  beforeEach(() => {
    writeTasks([
      {
        id: 'task_1',
        title: 'Cannot verify me',
        kanban: 'awaiting-verification',
        verificationAttempts: 3,
      },
    ]);
  });

  it('writes a structured card the first time', async () => {
    expect(await reportVerificationCapReached('task_1', 3, 3)).toBe(true);

    const cards = readDecisions();
    expect(cards).toHaveLength(1);
    expect(cards[0].kind).toBe(VERIFICATION_CAP_KIND);
    expect(cards[0].attempts).toBe(3);
    expect(cards[0].max).toBe(3);
    // The human-readable context is still written.
    expect(String(cards[0].context)).toContain('verification attempts exhausted');
  });

  it('does not re-fire once the card has been ANSWERED', async () => {
    expect(await reportVerificationCapReached('task_1', 3, 3)).toBe(true);

    const cards = readDecisions();
    cards[0].status = 'answered';
    cards[0].answer = 'Investigate the harness';
    writeDecisions(cards);

    expect(await reportVerificationCapReached('task_1', 3, 3)).toBe(false);
    expect(readDecisions()).toHaveLength(1);
  });

  it('treats a legacy card with no structured fields as already reported', async () => {
    writeDecisions([
      {
        id: 'dec_legacy',
        taskId: 'task_1',
        status: 'answered',
        context:
          'verification attempts exhausted: 3/3 runs started, none produced a passing verdict.',
      },
    ]);

    expect(await reportVerificationCapReached('task_1', 3, 3)).toBe(false);
    expect(readDecisions()).toHaveLength(1);
  });

  it('raises a fresh card when a new round of attempts is exhausted', async () => {
    expect(await reportVerificationCapReached('task_1', 3, 3)).toBe(true);
    const cards = readDecisions();
    cards[0].status = 'answered';
    cards[0].answer = 'Raise the attempt cap';
    writeDecisions(cards);

    // The fresh round ran out too: a different attempt count, so a different fact.
    expect(await reportVerificationCapReached('task_1', 6, 3)).toBe(true);
    expect(readDecisions()).toHaveLength(2);
  });

  it('does not confuse two tasks', async () => {
    writeTasks([
      { id: 'task_1', kanban: 'awaiting-verification', verificationAttempts: 3 },
      { id: 'task_2', kanban: 'awaiting-verification', verificationAttempts: 3 },
    ]);

    expect(await reportVerificationCapReached('task_1', 3, 3)).toBe(true);
    expect(await reportVerificationCapReached('task_2', 3, 3)).toBe(true);
    expect(readDecisions()).toHaveLength(2);
  });
});

// ─── Defect 3 ────────────────────────────────────────────────────────────────

describe('consumeAnsweredCapCards — the four answers actually do something', () => {
  beforeEach(() => {
    writeTasks([
      {
        id: 'task_1',
        title: 'Parked',
        kanban: 'awaiting-verification',
        verificationStatus: 'unverified',
        verificationAttempts: 3,
        completedAt: null,
      },
      { id: 'task_dep', title: 'Waiting on it', kanban: 'not-started', blockedBy: ['task_1'] },
    ]);
  });

  it('accepts the work as is: done, waived, completed, dependents unblocked', async () => {
    writeDecisions([capCard({ answer: 'Accept as is (unverified)' })]);

    expect(await consumeAnsweredCapCards()).toBe(1);

    expect(task('task_1').kanban).toBe('done');
    expect(task('task_1').verificationStatus).toBe('waived');
    expect(task('task_1').completedAt).toBeTruthy();
    // Unblocked because its blocker is DONE, not because the link was deleted:
    // pruning it destroyed the only record of the dependency (M5).
    expect(task('task_dep').blockedBy).toEqual(['task_1']);
    expect(task('task_1').kanban).toBe('done');
    expect(readDecisions()[0].consumedAt).toBeTruthy();
  });

  it('sends the task back to the builder with a clean slate', async () => {
    writeDecisions([capCard({ answer: 'Send back to the builder' })]);

    expect(await consumeAnsweredCapCards()).toBe(1);

    expect(task('task_1').kanban).toBe('not-started');
    expect(task('task_1').verificationStatus).toBe('unverified');
    expect(task('task_1').verificationAttempts).toBe(0);
  });

  it('raises the cap by granting a fresh round of attempts', async () => {
    writeDecisions([capCard({ answer: 'Raise the attempt cap' })]);

    expect(await consumeAnsweredCapCards()).toBe(1);

    expect(task('task_1').kanban).toBe('awaiting-verification');
    expect(task('task_1').verificationAttempts).toBe(0);
  });

  it("touches nothing for 'Investigate the harness', but consumes the card", async () => {
    writeDecisions([capCard({ answer: 'Investigate the harness' })]);

    expect(await consumeAnsweredCapCards()).toBe(1);

    expect(task('task_1').kanban).toBe('awaiting-verification');
    expect(task('task_1').verificationAttempts).toBe(3);
    expect(readDecisions()[0].consumedAt).toBeTruthy();
  });

  it('consumes an answer nobody wrote a transition for, without touching the task', async () => {
    writeDecisions([capCard({ answer: 'something the human typed' })]);

    expect(await consumeAnsweredCapCards()).toBe(1);

    expect(task('task_1').kanban).toBe('awaiting-verification');
    expect(readDecisions()[0].consumedAt).toBeTruthy();
  });

  it('never applies the same card twice', async () => {
    writeDecisions([capCard({ answer: 'Raise the attempt cap' })]);
    expect(await consumeAnsweredCapCards()).toBe(1);

    // A second round of attempts has since been burned; re-applying would wipe it.
    const tasks = readTasks();
    tasks.find((t) => t.id === 'task_1')!.verificationAttempts = 2;
    writeTasks(tasks);

    expect(await consumeAnsweredCapCards()).toBe(0);
    expect(task('task_1').verificationAttempts).toBe(2);
  });

  it('ignores pending cards and cards of other kinds', async () => {
    writeDecisions([
      capCard({ id: 'dec_pending', status: 'pending', answer: null }),
      capCard({ id: 'dec_other', kind: undefined, answer: 'Accept as is (unverified)' }),
    ]);

    expect(await consumeAnsweredCapCards()).toBe(0);
    expect(task('task_1').kanban).toBe('awaiting-verification');
  });

  it('consumes without touching a task a human already moved', async () => {
    const tasks = readTasks();
    tasks.find((t) => t.id === 'task_1')!.kanban = 'done';
    writeTasks(tasks);
    writeDecisions([capCard({ answer: 'Send back to the builder' })]);

    expect(await consumeAnsweredCapCards()).toBe(1);

    expect(task('task_1').kanban).toBe('done');
    expect(readDecisions()[0].consumedAt).toBeTruthy();
  });

  it('consumes a card whose task no longer exists', async () => {
    writeDecisions([capCard({ taskId: 'task_gone', answer: 'Accept as is (unverified)' })]);

    expect(await consumeAnsweredCapCards()).toBe(1);
    expect(readDecisions()[0].consumedAt).toBeTruthy();
  });
});

// ─── Defect 4 (H6) ───────────────────────────────────────────────────────────

/** A verdict carrying judge questions. Only the fields appendHumanDecisions reads. */
function verdictWith(
  humanDecisions: Array<{ question: string; context: string; duplicateOf?: string | null }>,
  taskId = 'task_1',
  runId = 'vrun_1',
): Parameters<typeof appendHumanDecisions>[0] {
  return {
    runId,
    taskId,
    contractId: 'contract_1',
    contractVersion: 1,
    outcome: 'failed',
    criterionVerdicts: [],
    humanDecisions,
    judgeModel: 'test',
    createdAt: new Date().toISOString(),
    signature: null,
  };
}

const QUESTION = 'The save button works but takes 4 clicks — accept?';

describe('appendHumanDecisions — the same question is never asked twice', () => {
  it('raises a new question and stores its fingerprint', async () => {
    expect(
      await appendHumanDecisions(verdictWith([{ question: QUESTION, context: 'seen on run 1' }])),
    ).toBe(1);

    const [card] = readDecisions();
    expect(card.question).toBe(QUESTION);
    expect(card.questionFingerprint).toBe(questionFingerprint(QUESTION));
    expect(card.status).toBe('pending');
  });

  it('does not re-ask a question that is still pending', async () => {
    await appendHumanDecisions(verdictWith([{ question: QUESTION, context: 'run 1' }]));

    expect(
      await appendHumanDecisions(
        verdictWith([{ question: QUESTION, context: 'run 2' }], 'task_1', 'vrun_2'),
      ),
    ).toBe(0);
    expect(readDecisions()).toHaveLength(1);
  });

  it('does not re-ask a question the human already ANSWERED', async () => {
    await appendHumanDecisions(verdictWith([{ question: QUESTION, context: 'run 1' }]));
    const cards = readDecisions();
    cards[0].status = 'answered';
    cards[0].answer = 'Accept as is';
    writeDecisions(cards);

    expect(
      await appendHumanDecisions(
        verdictWith([{ question: QUESTION, context: 'run 2' }], 'task_1', 'vrun_2'),
      ),
    ).toBe(0);
    expect(readDecisions()).toHaveLength(1);
  });

  it('collapses duplicates raised inside ONE verdict', async () => {
    expect(
      await appendHumanDecisions(
        verdictWith([
          { question: QUESTION, context: 'the walker saw it' },
          { question: QUESTION, context: 'the naive user saw it too' },
        ]),
      ),
    ).toBe(1);
    expect(readDecisions()).toHaveLength(1);
  });

  it('treats a re-ask that differs only in ids, counts and timestamps as the same question', async () => {
    await appendHumanDecisions(
      verdictWith([
        {
          question: 'Task 4 at 2026-08-26T10:00:00Z (run a1b2c3d4) is slow — accept?',
          context: '',
        },
      ]),
    );

    expect(
      await appendHumanDecisions(
        verdictWith(
          [
            {
              question: 'Task 11 at 2026-08-26T11:31:02Z (run 9f8e7d6c) is slow — accept?',
              context: '',
            },
          ],
          'task_1',
          'vrun_2',
        ),
      ),
    ).toBe(0);
    expect(readDecisions()).toHaveLength(1);
  });

  it('still asks a genuinely different question', async () => {
    await appendHumanDecisions(verdictWith([{ question: QUESTION, context: '' }]));

    expect(
      await appendHumanDecisions(
        verdictWith(
          [{ question: 'Should deleting a project ask twice?', context: '' }],
          'task_1',
          'vrun_2',
        ),
      ),
    ).toBe(1);
    expect(readDecisions()).toHaveLength(2);
  });

  it('does not confuse two tasks — the same question on each is two questions', async () => {
    await appendHumanDecisions(verdictWith([{ question: QUESTION, context: '' }], 'task_1'));

    expect(
      await appendHumanDecisions(verdictWith([{ question: QUESTION, context: '' }], 'task_2')),
    ).toBe(1);
    expect(readDecisions()).toHaveLength(2);
  });

  it('drops a question the judge itself declared a duplicate', async () => {
    writeDecisions([
      {
        id: 'dec_open',
        taskId: 'task_1',
        question: QUESTION,
        status: 'pending',
        questionFingerprint: questionFingerprint(QUESTION),
      },
    ]);

    expect(
      await appendHumanDecisions(
        verdictWith([
          {
            question: 'The click count on save is still high — accept?',
            context: '',
            duplicateOf: 'dec_open',
          },
        ]),
      ),
    ).toBe(0);
    expect(readDecisions()).toHaveLength(1);
  });

  it('dedupes against a card written before fingerprints existed', async () => {
    writeDecisions([{ id: 'dec_legacy', taskId: 'task_1', question: QUESTION, status: 'pending' }]);

    expect(await appendHumanDecisions(verdictWith([{ question: QUESTION, context: '' }]))).toBe(0);
    expect(readDecisions()).toHaveLength(1);
  });
});

// ─── Defect 5 (H8) ───────────────────────────────────────────────────────────

/** A judge decision card the human answered, as appendHumanDecisions writes them. */
function judgeCard(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'dec_judge_1',
    requestedBy: 'system',
    taskId: 'task_1',
    question: 'Saving works but takes six clicks — accept?',
    options: ['Accept as is', 'Open a follow-up task', 'Reject — needs rework'],
    context: 'naive-user-2 gave up twice.\n\nRaised by the acceptance panel in run vrun_77.',
    status: 'answered',
    answer: 'Open a follow-up task',
    answeredAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    blocksTask: false,
    ...over,
  };
}

describe("consumeAnsweredFollowUps — 'Open a follow-up task' actually opens one", () => {
  beforeEach(() => {
    writeTasks([
      {
        id: 'task_1',
        title: 'The origin',
        kanban: 'awaiting-verification',
        assignedTo: 'developer',
        importance: 'important',
        urgency: 'urgent',
        projectId: 'proj_1',
      } as TaskFixture,
    ]);
  });

  const followUp = (): TaskFixture | undefined => readTasks().find((t) => t.id !== 'task_1');

  it('creates the task on the same project, blocked on the origin, and records it', async () => {
    writeDecisions([judgeCard()]);

    expect(await consumeAnsweredFollowUps()).toBe(1);

    const created = followUp()!;
    expect(created.title).toContain('six clicks');
    expect(created.kanban).toBe('not-started');
    expect(created.blockedBy).toEqual(['task_1']);
    expect(created.assignedTo).toBe('developer');
    expect(created.projectId).toBe('proj_1');
    expect(created.importance).toBe('important');
    expect(created.urgency).toBe('urgent');
    // The question's context and the run that raised it travel with it.
    expect(created.description).toContain('naive-user-2 gave up twice');
    expect(created.description).toContain('vrun_77');

    const card = readDecisions()[0];
    expect(card.consumedAt).toBeTruthy();
    expect(card.consequenceTaskIds).toEqual([created.id]);
  });

  it('does not block on an origin that is already done', async () => {
    const tasks = readTasks();
    tasks[0].kanban = 'done';
    writeTasks(tasks);
    writeDecisions([judgeCard()]);

    expect(await consumeAnsweredFollowUps()).toBe(1);
    expect(followUp()!.blockedBy).toEqual([]);
  });

  it('never opens a second task for the same card', async () => {
    writeDecisions([judgeCard()]);
    expect(await consumeAnsweredFollowUps()).toBe(1);

    expect(await consumeAnsweredFollowUps()).toBe(0);
    expect(readTasks()).toHaveLength(2);
  });

  it('ignores cards answered any other way, and pending ones', async () => {
    writeDecisions([
      judgeCard({ id: 'dec_a', answer: 'Accept as is' }),
      judgeCard({ id: 'dec_b', status: 'pending', answer: null }),
      judgeCard({ id: 'dec_c', answer: 'Reject — needs rework' }),
    ]);

    expect(await consumeAnsweredFollowUps()).toBe(0);
    expect(readTasks()).toHaveLength(1);
  });

  it('consumes a card whose origin task is gone, without inventing a task', async () => {
    writeDecisions([judgeCard({ taskId: 'task_gone' })]);

    expect(await consumeAnsweredFollowUps()).toBe(1);
    expect(readTasks()).toHaveLength(1);
    expect(readDecisions()[0].consequenceTaskIds).toEqual([]);
  });

  it('clamps a rambling question into a title', async () => {
    writeDecisions([judgeCard({ question: `Should we ${'really '.repeat(60)}do this?` })]);

    expect(await consumeAnsweredFollowUps()).toBe(1);
    expect(followUp()!.title!.length).toBeLessThanOrEqual(121);
    // Nothing is lost: the whole question is still on the task.
    expect(followUp()!.description).toContain('really really');
  });
});

describe('openDecisionsForTask — what the judge is shown', () => {
  it("returns the task's pending questions, and nothing answered or foreign", () => {
    writeDecisions([
      { id: 'dec_1', taskId: 'task_1', question: 'still open', status: 'pending' },
      { id: 'dec_2', taskId: 'task_1', question: 'settled', status: 'answered' },
      { id: 'dec_3', taskId: 'task_2', question: "someone else's", status: 'pending' },
    ]);

    expect(openDecisionsForTask('task_1')).toEqual([{ id: 'dec_1', question: 'still open' }]);
    expect(openDecisionsForTask(null)).toEqual([]);
  });
});
