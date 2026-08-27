/**
 * Shared utilities for integration tests.
 *
 * Provides factory functions and assertion helpers for composing
 * multi-system test scenarios (tasks + inbox + activity log + decisions).
 */

import type { ActivityEvent, DecisionItem, InboxMessage, Task } from '@ligma/api';
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

// ─── Entity Factories ───────────────────────────────────────────────────────

/** Create a task with sensible defaults, persisted to tasks.json. */
export async function createTask(overrides: Partial<Task> = {}): Promise<Task> {
  const now = new Date().toISOString();
  const task: Task = {
    id: `task_integ_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: 'Integration test task',
    description: '',
    importance: 'important',
    urgency: 'urgent',
    kanban: 'not-started',
    verificationStatus: 'unverified',
    projectId: null,
    milestoneId: null,
    assignedTo: null,
    collaborators: [],
    dailyActions: [],
    subtasks: [],
    blockedBy: [],
    estimatedMinutes: null,
    actualMinutes: null,
    acceptanceCriteria: [],
    comments: [],
    tags: ['integration-test'],
    notes: '',
    createdAt: now,
    updatedAt: now,
    dueDate: null,
    completedAt: null,
    deletedAt: null,
    ...overrides,
  };

  const data = await getTasks();
  data.tasks.push(task);
  await saveTasks(data);
  return task;
}

/** Create an inbox message, persisted to inbox.json. */
export async function createMessage(overrides: Partial<InboxMessage> = {}): Promise<InboxMessage> {
  const msg: InboxMessage = {
    id: `msg_integ_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    from: 'system',
    to: 'developer',
    type: 'update',
    taskId: null,
    subject: 'Integration test message',
    body: '',
    status: 'unread',
    createdAt: new Date().toISOString(),
    readAt: null,
    ...overrides,
  };

  const data = await getInbox();
  data.messages.push(msg);
  await saveInbox(data);
  return msg;
}

/** Create an activity log event, persisted to activity-log.json. */
export async function createEvent(overrides: Partial<ActivityEvent> = {}): Promise<ActivityEvent> {
  const event: ActivityEvent = {
    id: `evt_integ_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type: 'task_created',
    actor: 'system',
    taskId: null,
    summary: 'Integration test event',
    details: '',
    timestamp: new Date().toISOString(),
    ...overrides,
  };

  const data = await getActivityLog();
  data.events.push(event);
  await saveActivityLog(data);
  return event;
}

/** Create a decision request, persisted to decisions.json. */
export async function createDecision(overrides: Partial<DecisionItem> = {}): Promise<DecisionItem> {
  const decision: DecisionItem = {
    id: `dec_integ_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    requestedBy: 'developer',
    taskId: null,
    question: 'Integration test decision?',
    options: ['Option A', 'Option B'],
    context: '',
    status: 'pending',
    answer: null,
    answeredAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };

  const data = await getDecisions();
  data.decisions.push(decision);
  await saveDecisions(data);
  return decision;
}

// ─── Cross-System Helpers ───────────────────────────────────────────────────

/**
 * Create a task + delegation message + activity event in one call.
 * Simulates the full "task assignment" flow across multiple systems.
 */
export async function assignTaskToAgent(
  agent: string,
  taskOverrides: Partial<Task> = {},
): Promise<{ task: Task; message: InboxMessage; event: ActivityEvent }> {
  const task = await createTask({
    assignedTo: agent,
    ...taskOverrides,
  });

  const message = await createMessage({
    from: 'me',
    to: agent,
    type: 'delegation',
    taskId: task.id,
    subject: `New assignment: ${task.title}`,
    body: `Please complete: ${task.description}`,
  });

  const event = await createEvent({
    type: 'task_delegated',
    actor: 'me',
    taskId: task.id,
    summary: `Task delegated to ${agent}: ${task.title}`,
  });

  return { task, message, event };
}

/**
 * Mark a task as complete and post a report. Simulates agent task completion.
 */
export async function completeTask(
  taskId: string,
  agent: string,
  reportBody = 'Task completed successfully.',
): Promise<{ message: InboxMessage; event: ActivityEvent }> {
  const now = new Date().toISOString();

  // Update task status
  const tasksData = await getTasks();
  const task = tasksData.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  task.kanban = 'done';
  task.completedAt = now;
  task.updatedAt = now;
  task.subtasks.forEach((s) => (s.done = true));
  await saveTasks(tasksData);

  // Post completion report
  const message = await createMessage({
    from: agent,
    to: 'me',
    type: 'report',
    taskId,
    subject: `Completed: ${task.title}`,
    body: reportBody,
  });

  // Log activity
  const event = await createEvent({
    type: 'task_completed',
    actor: agent,
    taskId,
    summary: `Completed: ${task.title}`,
  });

  return { message, event };
}

// ─── Assertion Helpers ──────────────────────────────────────────────────────

/** Find a task by ID from current tasks.json state. */
export async function findTask(taskId: string): Promise<Task | undefined> {
  const data = await getTasks();
  return data.tasks.find((t) => t.id === taskId);
}

/** Find inbox messages related to a task. */
export async function findTaskMessages(taskId: string): Promise<InboxMessage[]> {
  const data = await getInbox();
  return data.messages.filter((m) => m.taskId === taskId);
}

/** Find activity events related to a task. */
export async function findTaskEvents(taskId: string): Promise<ActivityEvent[]> {
  const data = await getActivityLog();
  return data.events.filter((e) => e.taskId === taskId);
}
