import type { ActivityEvent, DecisionItem, InboxMessage, Task } from '@ligma/api';
import { describe, expect, it } from 'vitest';
import {
  getActivityLog,
  getDecisions,
  getInbox,
  getTasks,
  saveActivityLog,
  saveDecisions,
  saveInbox,
  saveTasks,
} from '../../src/store/data';

// Data backup/restore is handled automatically by setup.ts

// ─── Full Agent Communication Flow ──────────────────────────────────────────

describe('agent communication flow', () => {
  const taskId = `task_integration_${Date.now()}`;
  const now = new Date().toISOString();

  it('Step 1: creates a task and assigns it to an agent', async () => {
    const tasksData = await getTasks();

    const newTask: Task = {
      id: taskId,
      title: 'Integration test task',
      description: 'Test the full agent flow',
      importance: 'important',
      urgency: 'urgent',
      kanban: 'not-started',
      verificationStatus: 'unverified',
      projectId: null,
      milestoneId: null,
      assignedTo: 'developer',
      collaborators: ['researcher'],
      dailyActions: [],
      subtasks: [
        { id: 'st_1', title: 'Write code', done: false },
        { id: 'st_2', title: 'Write tests', done: false },
      ],
      blockedBy: [],
      estimatedMinutes: 60,
      actualMinutes: null,
      acceptanceCriteria: ['Code compiles', 'Tests pass'],
      comments: [],
      tags: ['integration-test'],
      notes: '',
      createdAt: now,
      updatedAt: now,
      dueDate: null,
      completedAt: null,
      deletedAt: null,
    };

    tasksData.tasks.push(newTask);
    await saveTasks(tasksData);

    // Verify task was created
    const reread = await getTasks();
    const found = reread.tasks.find((t) => t.id === taskId);
    expect(found).toBeDefined();
    expect(found?.assignedTo).toBe('developer');
    expect(found?.collaborators).toContain('researcher');
    expect(found?.subtasks).toHaveLength(2);
  });

  it('Step 2: sends a delegation message to the assigned agent inbox', async () => {
    const inboxData = await getInbox();

    const delegationMsg: InboxMessage = {
      id: `msg_delegation_${Date.now()}`,
      from: 'me',
      to: 'developer',
      type: 'delegation',
      taskId: taskId,
      subject: 'New task: Integration test task',
      body: 'Please complete the integration test task. Subtasks: Write code, Write tests.',
      status: 'unread',
      createdAt: now,
      readAt: null,
    };

    inboxData.messages.push(delegationMsg);
    await saveInbox(inboxData);

    // Verify delegation message exists
    const rereadInbox = await getInbox();
    const foundMsg = rereadInbox.messages.find(
      (m) => m.taskId === taskId && m.type === 'delegation',
    );
    expect(foundMsg).toBeDefined();
    expect(foundMsg?.to).toBe('developer');
    expect(foundMsg?.status).toBe('unread');
  });

  it('Step 3: logs a task_created activity event', async () => {
    const logData = await getActivityLog();

    const event: ActivityEvent = {
      id: `evt_created_${Date.now()}`,
      type: 'task_created',
      actor: 'me',
      taskId: taskId,
      summary: 'Created task: Integration test task',
      details: 'Assigned to developer with researcher as collaborator',
      timestamp: now,
    };

    logData.events.push(event);
    await saveActivityLog(logData);

    // Verify event was logged
    const rereadLog = await getActivityLog();
    const foundEvent = rereadLog.events.find(
      (e) => e.taskId === taskId && e.type === 'task_created',
    );
    expect(foundEvent).toBeDefined();
    expect(foundEvent?.actor).toBe('me');
  });

  it('Step 4: agent marks task in-progress and updates subtasks', async () => {
    const tasksData = await getTasks();
    const task = tasksData.tasks.find((t) => t.id === taskId);
    expect(task).toBeDefined();

    task!.kanban = 'in-progress';
    task!.subtasks[0].done = true; // "Write code" completed
    task!.actualMinutes = 30;
    task!.updatedAt = new Date().toISOString();

    await saveTasks(tasksData);

    // Verify updates
    const reread = await getTasks();
    const updated = reread.tasks.find((t) => t.id === taskId);
    expect(updated?.kanban).toBe('in-progress');
    expect(updated?.subtasks[0].done).toBe(true);
    expect(updated?.subtasks[1].done).toBe(false);
    expect(updated?.actualMinutes).toBe(30);
  });

  it('Step 5: agent logs a task_updated event for progress', async () => {
    const logData = await getActivityLog();

    const event: ActivityEvent = {
      id: `evt_progress_${Date.now()}`,
      type: 'task_updated',
      actor: 'developer',
      taskId: taskId,
      summary: 'In progress: Integration test task',
      details: 'Completed subtask: Write code. 30 minutes spent so far.',
      timestamp: new Date().toISOString(),
    };

    logData.events.push(event);
    await saveActivityLog(logData);

    const rereadLog = await getActivityLog();
    const progressEvents = rereadLog.events.filter(
      (e) => e.taskId === taskId && e.type === 'task_updated',
    );
    expect(progressEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('Step 6: agent completes the task', async () => {
    const tasksData = await getTasks();
    const task = tasksData.tasks.find((t) => t.id === taskId);
    expect(task).toBeDefined();

    const completedAt = new Date().toISOString();
    task!.kanban = 'done';
    task!.subtasks[1].done = true; // "Write tests" completed
    task!.actualMinutes = 55;
    task!.completedAt = completedAt;
    task!.updatedAt = completedAt;

    await saveTasks(tasksData);

    // Verify completion
    const reread = await getTasks();
    const completed = reread.tasks.find((t) => t.id === taskId);
    expect(completed?.kanban).toBe('done');
    expect(completed?.completedAt).toBe(completedAt);
    expect(completed?.subtasks.every((s) => s.done)).toBe(true);
  });

  it('Step 7: agent posts completion report to inbox', async () => {
    const inboxData = await getInbox();

    const report: InboxMessage = {
      id: `msg_report_${Date.now()}`,
      from: 'developer',
      to: 'me',
      type: 'report',
      taskId: taskId,
      subject: 'Completed: Integration test task',
      body: 'Task completed successfully. All subtasks done. Took 55 minutes (estimated 60).',
      status: 'unread',
      createdAt: new Date().toISOString(),
      readAt: null,
    };

    inboxData.messages.push(report);
    await saveInbox(inboxData);

    // Verify report
    const rereadInbox = await getInbox();
    const foundReport = rereadInbox.messages.find(
      (m) => m.taskId === taskId && m.type === 'report',
    );
    expect(foundReport).toBeDefined();
    expect(foundReport?.from).toBe('developer');
    expect(foundReport?.to).toBe('me');
    expect(foundReport?.subject).toContain('Completed');
  });

  it('Step 8: logs a task_completed activity event', async () => {
    const logData = await getActivityLog();

    const event: ActivityEvent = {
      id: `evt_completed_${Date.now()}`,
      type: 'task_completed',
      actor: 'developer',
      taskId: taskId,
      summary: 'Completed: Integration test task',
      details: 'All subtasks completed. Actual time: 55min vs estimated 60min.',
      timestamp: new Date().toISOString(),
    };

    logData.events.push(event);
    await saveActivityLog(logData);

    const rereadLog = await getActivityLog();
    const completionEvent = rereadLog.events.find(
      (e) => e.taskId === taskId && e.type === 'task_completed',
    );
    expect(completionEvent).toBeDefined();
    expect(completionEvent?.actor).toBe('developer');
  });

  it('Step 9: verifies the full lifecycle in activity log', async () => {
    const logData = await getActivityLog();
    const taskEvents = logData.events.filter((e) => e.taskId === taskId);

    // Should have at least: task_created, task_updated, task_completed
    const types = taskEvents.map((e) => e.type);
    expect(types).toContain('task_created');
    expect(types).toContain('task_updated');
    expect(types).toContain('task_completed');
  });

  it('Step 10: verifies inbox has both delegation and report', async () => {
    const inboxData = await getInbox();
    const taskMessages = inboxData.messages.filter((m) => m.taskId === taskId);

    const types = taskMessages.map((m) => m.type);
    expect(types).toContain('delegation');
    expect(types).toContain('report');
    expect(taskMessages.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── Decision Request Flow ──────────────────────────────────────────────────

describe('decision request flow', () => {
  const decisionId = `dec_integration_${Date.now()}`;

  it('agent creates a pending decision request', async () => {
    const decisionsData = await getDecisions();

    const decision: DecisionItem = {
      id: decisionId,
      requestedBy: 'developer',
      taskId: null,
      question: 'Should we use PostgreSQL or SQLite for the new project?',
      options: ['PostgreSQL', 'SQLite', 'Both'],
      context: 'Local-first development suggests SQLite, but future scaling may need PostgreSQL.',
      status: 'pending',
      answer: null,
      answeredAt: null,
      createdAt: new Date().toISOString(),
    };

    decisionsData.decisions.push(decision);
    await saveDecisions(decisionsData);

    // Verify
    const reread = await getDecisions();
    const found = reread.decisions.find((d) => d.id === decisionId);
    expect(found).toBeDefined();
    expect(found?.status).toBe('pending');
    expect(found?.options).toHaveLength(3);
  });

  it('logs a decision_requested event', async () => {
    const logData = await getActivityLog();

    const event: ActivityEvent = {
      id: `evt_dec_req_${Date.now()}`,
      type: 'decision_requested',
      actor: 'developer',
      taskId: null,
      summary: 'Decision needed: Database choice',
      details: 'Should we use PostgreSQL or SQLite?',
      timestamp: new Date().toISOString(),
    };

    logData.events.push(event);
    await saveActivityLog(logData);

    const rereadLog = await getActivityLog();
    const decEvents = rereadLog.events.filter(
      (e) => e.type === 'decision_requested' && e.actor === 'developer',
    );
    expect(decEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('user answers the decision', async () => {
    const decisionsData = await getDecisions();
    const decision = decisionsData.decisions.find((d) => d.id === decisionId);
    expect(decision).toBeDefined();

    decision!.status = 'answered';
    decision!.answer = 'SQLite';
    decision!.answeredAt = new Date().toISOString();

    await saveDecisions(decisionsData);

    // Verify
    const reread = await getDecisions();
    const answered = reread.decisions.find((d) => d.id === decisionId);
    expect(answered?.status).toBe('answered');
    expect(answered?.answer).toBe('SQLite');
    expect(answered?.answeredAt).toBeDefined();
  });

  it('logs a decision_answered event', async () => {
    const logData = await getActivityLog();

    const event: ActivityEvent = {
      id: `evt_dec_ans_${Date.now()}`,
      type: 'decision_answered',
      actor: 'me',
      taskId: null,
      summary: 'Decision answered: Database choice',
      details: 'Chose SQLite for local-first approach',
      timestamp: new Date().toISOString(),
    };

    logData.events.push(event);
    await saveActivityLog(logData);

    const rereadLog = await getActivityLog();
    const ansEvents = rereadLog.events.filter(
      (e) => e.type === 'decision_answered' && e.actor === 'me',
    );
    expect(ansEvents.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Blocked Task Flow ──────────────────────────────────────────────────────

describe('blocked task dependency flow', () => {
  const blockerTaskId = `task_blocker_${Date.now()}`;
  const blockedTaskId = `task_blocked_${Date.now()}`;

  it('creates a blocker task and a blocked task', async () => {
    const tasksData = await getTasks();

    const blockerTask: Task = {
      id: blockerTaskId,
      title: 'Setup database',
      description: 'Initialize the database schema',
      importance: 'important',
      urgency: 'urgent',
      kanban: 'not-started',
      verificationStatus: 'unverified',
      projectId: null,
      milestoneId: null,
      assignedTo: 'developer',
      collaborators: [],
      dailyActions: [],
      subtasks: [],
      blockedBy: [],
      estimatedMinutes: 30,
      actualMinutes: null,
      acceptanceCriteria: [],
      comments: [],
      tags: [],
      notes: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      dueDate: null,
      completedAt: null,
      deletedAt: null,
    };

    const blockedTask: Task = {
      id: blockedTaskId,
      title: 'Build API endpoints',
      description: 'Create REST API on top of database',
      importance: 'important',
      urgency: 'urgent',
      kanban: 'not-started',
      verificationStatus: 'unverified',
      projectId: null,
      milestoneId: null,
      assignedTo: 'developer',
      collaborators: [],
      dailyActions: [],
      subtasks: [],
      blockedBy: [blockerTaskId],
      estimatedMinutes: 120,
      actualMinutes: null,
      acceptanceCriteria: [],
      comments: [],
      tags: [],
      notes: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      dueDate: null,
      completedAt: null,
      deletedAt: null,
    };

    tasksData.tasks.push(blockerTask, blockedTask);
    await saveTasks(tasksData);

    // Verify
    const reread = await getTasks();
    const blocked = reread.tasks.find((t) => t.id === blockedTaskId);
    expect(blocked?.blockedBy).toContain(blockerTaskId);
  });

  it('completing blocker unblocks the dependent task', async () => {
    const tasksData = await getTasks();

    // Complete the blocker
    const blocker = tasksData.tasks.find((t) => t.id === blockerTaskId);
    expect(blocker).toBeDefined();
    blocker!.kanban = 'done';
    blocker!.completedAt = new Date().toISOString();
    blocker!.updatedAt = new Date().toISOString();
    await saveTasks(tasksData);

    // Check if blocked task's dependencies are all done
    const reread = await getTasks();
    const blocked = reread.tasks.find((t) => t.id === blockedTaskId);
    expect(blocked).toBeDefined();

    const allBlockersCompleted = blocked!.blockedBy.every((depId) => {
      const dep = reread.tasks.find((t) => t.id === depId);
      return dep?.kanban === 'done';
    });
    expect(allBlockersCompleted).toBe(true);
  });

  it('sends an unblock notification to inbox', async () => {
    const inboxData = await getInbox();

    const notification: InboxMessage = {
      id: `msg_unblock_${Date.now()}`,
      from: 'system',
      to: 'developer',
      type: 'update',
      taskId: blockedTaskId,
      subject: 'Task unblocked: Build API endpoints',
      body: `Dependency "${blockerTaskId}" is complete. This task is now unblocked and ready to start.`,
      status: 'unread',
      createdAt: new Date().toISOString(),
      readAt: null,
    };

    inboxData.messages.push(notification);
    await saveInbox(inboxData);

    // Verify
    const rereadInbox = await getInbox();
    const unblockMsg = rereadInbox.messages.find(
      (m) => m.taskId === blockedTaskId && m.subject.includes('unblocked'),
    );
    expect(unblockMsg).toBeDefined();
    expect(unblockMsg?.type).toBe('update');
  });
});
