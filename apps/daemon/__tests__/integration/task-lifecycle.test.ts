/**
 * Integration test: Task Lifecycle with Shared Utilities
 *
 * Demonstrates using the shared test-utils to compose multi-system
 * test scenarios with minimal boilerplate.
 */

import { describe, expect, it } from 'vitest';
import { getDecisions, saveDecisions } from '../../src/store/data';
import {
  assignTaskToAgent,
  completeTask,
  createDecision,
  findTask,
  findTaskEvents,
  findTaskMessages,
} from './test-utils';

// Data backup/restore is handled automatically by setup.ts

describe('task lifecycle via shared utilities', () => {
  let taskId: string;

  it('assigns a task to an agent (creates task + delegation + event)', async () => {
    const { task, message, event } = await assignTaskToAgent('developer', {
      title: 'Refactor auth module',
      description: 'Extract shared auth logic into a utility',
      subtasks: [
        { id: 'st_1', title: 'Identify shared logic', done: false },
        { id: 'st_2', title: 'Create utility module', done: false },
        { id: 'st_3', title: 'Update consumers', done: false },
      ],
    });

    taskId = task.id;

    // Task was persisted
    const found = await findTask(taskId);
    expect(found).toBeDefined();
    expect(found?.assignedTo).toBe('developer');
    expect(found?.subtasks).toHaveLength(3);

    // Delegation message was sent
    expect(message.type).toBe('delegation');
    expect(message.to).toBe('developer');

    // Activity event was logged
    expect(event.type).toBe('task_delegated');
  });

  it('completes the task (updates status + posts report + logs event)', async () => {
    const { message, event } = await completeTask(
      taskId,
      'developer',
      'Refactored auth module. Extracted shared logic into src/lib/auth-utils.ts.',
    );

    // Task is now done
    const task = await findTask(taskId);
    expect(task?.kanban).toBe('done');
    expect(task?.completedAt).toBeDefined();
    expect(task?.subtasks.every((s) => s.done)).toBe(true);

    // Report was posted
    expect(message.type).toBe('report');
    expect(message.from).toBe('developer');
    expect(message.to).toBe('me');

    // Activity was logged
    expect(event.type).toBe('task_completed');
  });

  it('has a complete audit trail across systems', async () => {
    const messages = await findTaskMessages(taskId);
    const events = await findTaskEvents(taskId);

    // Inbox: delegation + report
    const messageTypes = messages.map((m) => m.type);
    expect(messageTypes).toContain('delegation');
    expect(messageTypes).toContain('report');

    // Activity log: delegated + completed
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain('task_delegated');
    expect(eventTypes).toContain('task_completed');
  });
});

describe('decision flow integrated with task', () => {
  it('creates a decision linked to a task, then resolves it', async () => {
    const { task } = await assignTaskToAgent('developer', {
      title: 'Choose database engine',
    });

    // Agent requests a decision
    const decision = await createDecision({
      taskId: task.id,
      question: 'Which database for this project?',
      options: ['SQLite', 'PostgreSQL', 'DuckDB'],
      context: 'Local-first app, need embedded DB support.',
    });

    expect(decision.status).toBe('pending');
    expect(decision.taskId).toBe(task.id);

    // Human answers the decision
    const decisionsData = await getDecisions();
    const found = decisionsData.decisions.find((d) => d.id === decision.id);
    expect(found).toBeDefined();
    found!.status = 'answered';
    found!.answer = 'SQLite';
    found!.answeredAt = new Date().toISOString();
    await saveDecisions(decisionsData);

    // Verify the answer persisted
    const reread = await getDecisions();
    const answered = reread.decisions.find((d) => d.id === decision.id);
    expect(answered?.status).toBe('answered');
    expect(answered?.answer).toBe('SQLite');
  });
});
