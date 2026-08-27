import { describe, expect, it } from 'vitest';
import {
  LIMITS,
  activityEventCreateSchema,
  agentCreateSchema,
  agentUpdateSchema,
  brainDumpCreateSchema,
  brainDumpUpdateSchema,
  decisionCreateSchema,
  decisionUpdateSchema,
  goalCreateSchema,
  goalUpdateSchema,
  inboxCreateSchema,
  inboxUpdateSchema,
  projectCreateSchema,
  projectUpdateSchema,
  skillCreateSchema,
  skillUpdateSchema,
  taskCreateSchema,
  taskUpdateSchema,
} from '../src/store/validations';

// ─── Task Create Schema ────────────────────────────────────────────────────────

describe('taskCreateSchema', () => {
  it('accepts a valid task with only required fields', () => {
    const result = taskCreateSchema.safeParse({ title: 'Buy groceries' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('Buy groceries');
      // Defaults should be applied
      expect(result.data.importance).toBe('not-important');
      expect(result.data.urgency).toBe('not-urgent');
      expect(result.data.kanban).toBe('not-started');
      expect(result.data.description).toBe('');
      expect(result.data.projectId).toBeNull();
      expect(result.data.subtasks).toEqual([]);
      expect(result.data.tags).toEqual([]);
    }
  });

  it('accepts a fully specified task', () => {
    const result = taskCreateSchema.safeParse({
      title: 'Build feature',
      description: 'Implement the login page',
      importance: 'important',
      urgency: 'urgent',
      kanban: 'in-progress',
      projectId: 'proj_123',
      milestoneId: 'mile_456',
      assignedTo: 'developer',
      collaborators: ['researcher'],
      dailyActions: [{ id: 'da_1', title: 'Write tests', done: false, date: '2026-02-21' }],
      subtasks: [{ id: 'st_1', title: 'Create form', done: false }],
      blockedBy: ['task_001'],
      estimatedMinutes: 120,
      actualMinutes: 60,
      acceptanceCriteria: ['Login form works', 'Tests pass'],
      comments: [
        { id: 'c_1', author: 'developer', content: 'Started', createdAt: '2026-02-21T00:00:00Z' },
      ],
      tags: ['frontend', 'auth'],
      notes: 'Use shadcn/ui for components',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.importance).toBe('important');
      expect(result.data.kanban).toBe('in-progress');
      expect(result.data.assignedTo).toBe('developer');
      expect(result.data.subtasks).toHaveLength(1);
    }
  });

  it('rejects missing title', () => {
    const result = taskCreateSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects empty title', () => {
    const result = taskCreateSchema.safeParse({ title: '' });
    expect(result.success).toBe(false);
  });

  it('rejects title exceeding max length', () => {
    const result = taskCreateSchema.safeParse({ title: 'x'.repeat(LIMITS.TITLE + 1) });
    expect(result.success).toBe(false);
  });

  it('accepts title at exactly max length', () => {
    const result = taskCreateSchema.safeParse({ title: 'x'.repeat(LIMITS.TITLE) });
    expect(result.success).toBe(true);
  });

  it('rejects invalid importance value', () => {
    const result = taskCreateSchema.safeParse({ title: 'Test', importance: 'high' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid urgency value', () => {
    const result = taskCreateSchema.safeParse({ title: 'Test', urgency: 'very-urgent' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid kanban value', () => {
    const result = taskCreateSchema.safeParse({ title: 'Test', kanban: 'backlog' });
    expect(result.success).toBe(false);
  });

  it('rejects negative estimatedMinutes', () => {
    const result = taskCreateSchema.safeParse({ title: 'Test', estimatedMinutes: -10 });
    expect(result.success).toBe(false);
  });

  it('rejects estimatedMinutes exceeding max', () => {
    const result = taskCreateSchema.safeParse({
      title: 'Test',
      estimatedMinutes: LIMITS.MAX_MINUTES + 1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects too many subtasks', () => {
    const subtasks = Array.from({ length: LIMITS.MAX_SUBTASKS + 1 }, (_, i) => ({
      id: `st_${i}`,
      title: `Subtask ${i}`,
      done: false,
    }));
    const result = taskCreateSchema.safeParse({ title: 'Test', subtasks });
    expect(result.success).toBe(false);
  });

  it('rejects too many tags', () => {
    const tags = Array.from({ length: LIMITS.MAX_TAGS + 1 }, (_, i) => `tag_${i}`);
    const result = taskCreateSchema.safeParse({ title: 'Test', tags });
    expect(result.success).toBe(false);
  });

  it('rejects description exceeding max length', () => {
    const result = taskCreateSchema.safeParse({
      title: 'Test',
      description: 'x'.repeat(LIMITS.DESCRIPTION + 1),
    });
    expect(result.success).toBe(false);
  });
});

// ─── Task Update Schema ────────────────────────────────────────────────────────

describe('taskUpdateSchema', () => {
  it('accepts a valid update with id and partial fields', () => {
    const result = taskUpdateSchema.safeParse({
      id: 'task_123',
      title: 'Updated title',
      kanban: 'done',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('task_123');
      expect(result.data.title).toBe('Updated title');
      expect(result.data.kanban).toBe('done');
    }
  });

  it('accepts update with only id', () => {
    const result = taskUpdateSchema.safeParse({ id: 'task_123' });
    expect(result.success).toBe(true);
  });

  it('rejects missing id', () => {
    const result = taskUpdateSchema.safeParse({ title: 'New title' });
    expect(result.success).toBe(false);
  });

  it('rejects empty id', () => {
    const result = taskUpdateSchema.safeParse({ id: '' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid importance in update', () => {
    const result = taskUpdateSchema.safeParse({ id: 'task_123', importance: 'critical' });
    expect(result.success).toBe(false);
  });
});

// ─── Goal Create Schema ────────────────────────────────────────────────────────

describe('goalCreateSchema', () => {
  it('accepts a valid goal with only required fields', () => {
    const result = goalCreateSchema.safeParse({ title: 'Launch MVP' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('Launch MVP');
      expect(result.data.type).toBe('medium-term');
      expect(result.data.status).toBe('not-started');
      expect(result.data.milestones).toEqual([]);
      expect(result.data.tasks).toEqual([]);
    }
  });

  it('accepts a fully specified goal', () => {
    const result = goalCreateSchema.safeParse({
      title: 'Scale to 1000 users',
      type: 'long-term',
      timeframe: 'Q4 2026',
      parentGoalId: null,
      projectId: 'proj_123',
      status: 'in-progress',
      milestones: ['mile_1', 'mile_2'],
      tasks: ['task_1'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('long-term');
      expect(result.data.milestones).toHaveLength(2);
    }
  });

  it('rejects missing title', () => {
    const result = goalCreateSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects empty title', () => {
    const result = goalCreateSchema.safeParse({ title: '' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid type', () => {
    const result = goalCreateSchema.safeParse({ title: 'Goal', type: 'short-term' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid status', () => {
    const result = goalCreateSchema.safeParse({ title: 'Goal', status: 'cancelled' });
    expect(result.success).toBe(false);
  });

  it('rejects too many milestones', () => {
    const milestones = Array.from({ length: LIMITS.MAX_MILESTONES + 1 }, (_, i) => `mile_${i}`);
    const result = goalCreateSchema.safeParse({ title: 'Goal', milestones });
    expect(result.success).toBe(false);
  });

  it('rejects too many tasks', () => {
    const tasks = Array.from({ length: LIMITS.MAX_TASKS + 1 }, (_, i) => `task_${i}`);
    const result = goalCreateSchema.safeParse({ title: 'Goal', tasks });
    expect(result.success).toBe(false);
  });
});

// ─── Goal Update Schema ────────────────────────────────────────────────────────

describe('goalUpdateSchema', () => {
  it('accepts a valid update', () => {
    const result = goalUpdateSchema.safeParse({ id: 'goal_123', status: 'completed' });
    expect(result.success).toBe(true);
  });

  it('rejects missing id', () => {
    const result = goalUpdateSchema.safeParse({ title: 'Updated' });
    expect(result.success).toBe(false);
  });
});

// ─── Project Create Schema ─────────────────────────────────────────────────────

describe('projectCreateSchema', () => {
  it('accepts a valid project with only required fields', () => {
    const result = projectCreateSchema.safeParse({ name: 'My App' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('My App');
      expect(result.data.status).toBe('active');
      expect(result.data.color).toBe('#6B7280');
      expect(result.data.teamMembers).toEqual([]);
      expect(result.data.tags).toEqual([]);
    }
  });

  it('accepts a fully specified project', () => {
    const result = projectCreateSchema.safeParse({
      name: 'SaaS Platform',
      description: 'A multi-tenant SaaS',
      status: 'active',
      color: '#3b82f6',
      teamMembers: ['developer', 'researcher'],
      tags: ['saas', 'b2b'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing name', () => {
    const result = projectCreateSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects empty name', () => {
    const result = projectCreateSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects name exceeding max length', () => {
    const result = projectCreateSchema.safeParse({ name: 'x'.repeat(LIMITS.TITLE + 1) });
    expect(result.success).toBe(false);
  });

  it('rejects invalid status', () => {
    const result = projectCreateSchema.safeParse({ name: 'Test', status: 'deleted' });
    expect(result.success).toBe(false);
  });
});

// ─── Project Update Schema ─────────────────────────────────────────────────────

describe('projectUpdateSchema', () => {
  it('accepts a valid update', () => {
    const result = projectUpdateSchema.safeParse({ id: 'proj_123', status: 'paused' });
    expect(result.success).toBe(true);
  });

  it('rejects missing id', () => {
    const result = projectUpdateSchema.safeParse({ name: 'Updated' });
    expect(result.success).toBe(false);
  });
});

// ─── Inbox Create Schema ───────────────────────────────────────────────────────

describe('inboxCreateSchema', () => {
  it('accepts a valid message with required fields', () => {
    const result = inboxCreateSchema.safeParse({
      to: 'developer',
      subject: 'New task assigned',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.to).toBe('developer');
      expect(result.data.subject).toBe('New task assigned');
      expect(result.data.from).toBe('me');
      expect(result.data.type).toBe('update');
      expect(result.data.body).toBe('');
    }
  });

  it('accepts a fully specified message', () => {
    const result = inboxCreateSchema.safeParse({
      from: 'researcher',
      to: 'me',
      type: 'report',
      taskId: 'task_123',
      subject: 'Research complete',
      body: 'Found the following insights...',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing subject', () => {
    const result = inboxCreateSchema.safeParse({ to: 'developer' });
    expect(result.success).toBe(false);
  });

  it('rejects empty subject', () => {
    const result = inboxCreateSchema.safeParse({ to: 'developer', subject: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing to field', () => {
    const result = inboxCreateSchema.safeParse({ subject: 'Hello' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid message type', () => {
    const result = inboxCreateSchema.safeParse({
      to: 'developer',
      subject: 'Test',
      type: 'notification',
    });
    expect(result.success).toBe(false);
  });

  it('rejects subject exceeding max length', () => {
    const result = inboxCreateSchema.safeParse({
      to: 'developer',
      subject: 'x'.repeat(LIMITS.SUBJECT + 1),
    });
    expect(result.success).toBe(false);
  });

  it('rejects body exceeding max length', () => {
    const result = inboxCreateSchema.safeParse({
      to: 'developer',
      subject: 'Test',
      body: 'x'.repeat(LIMITS.BODY + 1),
    });
    expect(result.success).toBe(false);
  });
});

// ─── Inbox Update Schema ───────────────────────────────────────────────────────

describe('inboxUpdateSchema', () => {
  it('accepts a valid update', () => {
    const result = inboxUpdateSchema.safeParse({ id: 'msg_123', status: 'read' });
    expect(result.success).toBe(true);
  });

  it('rejects missing id', () => {
    const result = inboxUpdateSchema.safeParse({ status: 'read' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid status', () => {
    const result = inboxUpdateSchema.safeParse({ id: 'msg_123', status: 'deleted' });
    expect(result.success).toBe(false);
  });
});

// ─── Decision Create Schema ────────────────────────────────────────────────────

describe('decisionCreateSchema', () => {
  it('accepts a valid decision with required fields', () => {
    const result = decisionCreateSchema.safeParse({
      question: 'Which framework to use?',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.question).toBe('Which framework to use?');
      expect(result.data.requestedBy).toBe('developer');
      expect(result.data.options).toEqual([]);
      expect(result.data.context).toBe('');
    }
  });

  it('accepts a fully specified decision', () => {
    const result = decisionCreateSchema.safeParse({
      requestedBy: 'researcher',
      taskId: 'task_123',
      question: 'Should we use React or Vue?',
      options: ['React', 'Vue', 'Svelte'],
      context: 'We need a frontend framework for the new project.',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.options).toHaveLength(3);
    }
  });

  it('rejects missing question', () => {
    const result = decisionCreateSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects empty question', () => {
    const result = decisionCreateSchema.safeParse({ question: '' });
    expect(result.success).toBe(false);
  });

  it('rejects question exceeding max length', () => {
    const result = decisionCreateSchema.safeParse({
      question: 'x'.repeat(LIMITS.QUESTION + 1),
    });
    expect(result.success).toBe(false);
  });

  it('rejects too many options', () => {
    const options = Array.from({ length: LIMITS.MAX_OPTIONS + 1 }, (_, i) => `Option ${i}`);
    const result = decisionCreateSchema.safeParse({ question: 'Test?', options });
    expect(result.success).toBe(false);
  });

  it('rejects context exceeding max length', () => {
    const result = decisionCreateSchema.safeParse({
      question: 'Test?',
      context: 'x'.repeat(LIMITS.CONTEXT + 1),
    });
    expect(result.success).toBe(false);
  });
});

// ─── Decision Update Schema ────────────────────────────────────────────────────

describe('decisionUpdateSchema', () => {
  it('accepts a valid update', () => {
    const result = decisionUpdateSchema.safeParse({
      id: 'dec_123',
      status: 'answered',
      answer: 'React',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing id', () => {
    const result = decisionUpdateSchema.safeParse({ status: 'answered' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid status', () => {
    const result = decisionUpdateSchema.safeParse({ id: 'dec_123', status: 'rejected' });
    expect(result.success).toBe(false);
  });
});

// ─── Agent Create Schema ───────────────────────────────────────────────────────

describe('agentCreateSchema', () => {
  it('accepts a valid agent with required fields', () => {
    const result = agentCreateSchema.safeParse({
      id: 'test-agent',
      name: 'Test Agent',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('test-agent');
      expect(result.data.name).toBe('Test Agent');
      expect(result.data.icon).toBe('Bot');
      expect(result.data.description).toBe('');
      expect(result.data.instructions).toBe('');
      expect(result.data.capabilities).toEqual([]);
      expect(result.data.skillIds).toEqual([]);
      expect(result.data.status).toBe('active');
    }
  });

  it('accepts a fully specified agent', () => {
    const result = agentCreateSchema.safeParse({
      id: 'data-analyst',
      name: 'Data Analyst',
      icon: 'BarChart',
      description: 'Analyzes data and produces reports',
      instructions: 'You are a data analyst...',
      capabilities: ['SQL queries', 'Data visualization'],
      skillIds: ['skill_sql', 'skill_charts'],
      status: 'active',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing id', () => {
    const result = agentCreateSchema.safeParse({ name: 'Test Agent' });
    expect(result.success).toBe(false);
  });

  it('rejects missing name', () => {
    const result = agentCreateSchema.safeParse({ id: 'test-agent' });
    expect(result.success).toBe(false);
  });

  it('rejects empty id', () => {
    const result = agentCreateSchema.safeParse({ id: '', name: 'Test' });
    expect(result.success).toBe(false);
  });

  it('rejects id with spaces', () => {
    const result = agentCreateSchema.safeParse({ id: 'test agent', name: 'Test' });
    expect(result.success).toBe(false);
  });

  it('rejects id with uppercase letters', () => {
    const result = agentCreateSchema.safeParse({ id: 'TestAgent', name: 'Test' });
    expect(result.success).toBe(false);
  });

  it('rejects id with special characters', () => {
    const result = agentCreateSchema.safeParse({ id: 'test_agent!', name: 'Test' });
    expect(result.success).toBe(false);
  });

  it('accepts id with hyphens and numbers', () => {
    const result = agentCreateSchema.safeParse({ id: 'agent-123', name: 'Agent 123' });
    expect(result.success).toBe(true);
  });

  it('rejects name exceeding max length', () => {
    const result = agentCreateSchema.safeParse({
      id: 'test',
      name: 'x'.repeat(LIMITS.TITLE + 1),
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid status', () => {
    const result = agentCreateSchema.safeParse({
      id: 'test',
      name: 'Test',
      status: 'disabled',
    });
    expect(result.success).toBe(false);
  });
});

// ─── Agent Update Schema ───────────────────────────────────────────────────────

describe('agentUpdateSchema', () => {
  it('accepts a valid update', () => {
    const result = agentUpdateSchema.safeParse({ id: 'test-agent', status: 'inactive' });
    expect(result.success).toBe(true);
  });

  it('rejects missing id', () => {
    const result = agentUpdateSchema.safeParse({ name: 'Updated' });
    expect(result.success).toBe(false);
  });
});

// ─── Skill Create Schema ───────────────────────────────────────────────────────

describe('skillCreateSchema', () => {
  it('accepts a valid skill with required fields', () => {
    const result = skillCreateSchema.safeParse({ name: 'SQL Queries' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('SQL Queries');
      expect(result.data.description).toBe('');
      expect(result.data.content).toBe('');
      expect(result.data.agentIds).toEqual([]);
      expect(result.data.tags).toEqual([]);
    }
  });

  it('accepts a fully specified skill', () => {
    const result = skillCreateSchema.safeParse({
      name: 'Web Research',
      description: 'How to do web research effectively',
      content: '# Web Research Skill\n\nSearch the web...',
      agentIds: ['researcher'],
      tags: ['research', 'web'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing name', () => {
    const result = skillCreateSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects empty name', () => {
    const result = skillCreateSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects name exceeding max length', () => {
    const result = skillCreateSchema.safeParse({ name: 'x'.repeat(LIMITS.TITLE + 1) });
    expect(result.success).toBe(false);
  });

  it('rejects content exceeding max length (50000)', () => {
    const result = skillCreateSchema.safeParse({
      name: 'Test',
      content: 'x'.repeat(50001),
    });
    expect(result.success).toBe(false);
  });
});

// ─── Skill Update Schema ───────────────────────────────────────────────────────

describe('skillUpdateSchema', () => {
  it('accepts a valid update', () => {
    const result = skillUpdateSchema.safeParse({ id: 'skill_1', name: 'Updated Skill' });
    expect(result.success).toBe(true);
  });

  it('rejects missing id', () => {
    const result = skillUpdateSchema.safeParse({ name: 'Updated' });
    expect(result.success).toBe(false);
  });
});

// ─── Brain Dump Create Schema ──────────────────────────────────────────────────

describe('brainDumpCreateSchema', () => {
  it('accepts a valid entry with required fields', () => {
    const result = brainDumpCreateSchema.safeParse({ content: 'New app idea' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.content).toBe('New app idea');
      expect(result.data.processed).toBe(false);
      expect(result.data.convertedTo).toBeNull();
      expect(result.data.tags).toEqual([]);
    }
  });

  it('rejects missing content', () => {
    const result = brainDumpCreateSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects empty content', () => {
    const result = brainDumpCreateSchema.safeParse({ content: '' });
    expect(result.success).toBe(false);
  });

  it('rejects content exceeding max length', () => {
    const result = brainDumpCreateSchema.safeParse({
      content: 'x'.repeat(LIMITS.CONTENT + 1),
    });
    expect(result.success).toBe(false);
  });
});

// ─── Brain Dump Update Schema ──────────────────────────────────────────────────

describe('brainDumpUpdateSchema', () => {
  it('accepts a valid update', () => {
    const result = brainDumpUpdateSchema.safeParse({ id: 'bd_123', processed: true });
    expect(result.success).toBe(true);
  });

  it('rejects missing id', () => {
    const result = brainDumpUpdateSchema.safeParse({ processed: true });
    expect(result.success).toBe(false);
  });
});

// ─── Activity Event Create Schema ──────────────────────────────────────────────

describe('activityEventCreateSchema', () => {
  it('accepts a valid event with required fields', () => {
    const result = activityEventCreateSchema.safeParse({
      type: 'task_created',
      summary: 'Created new task',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('task_created');
      expect(result.data.actor).toBe('system');
      expect(result.data.taskId).toBeNull();
      expect(result.data.details).toBe('');
    }
  });

  it('accepts all valid event types', () => {
    const validTypes = [
      'task_created',
      'task_updated',
      'task_completed',
      'task_delegated',
      'message_sent',
      'decision_requested',
      'decision_answered',
      'brain_dump_triaged',
      'milestone_completed',
      'agent_checkin',
    ];
    for (const type of validTypes) {
      const result = activityEventCreateSchema.safeParse({
        type,
        summary: `Event: ${type}`,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid event type', () => {
    const result = activityEventCreateSchema.safeParse({
      type: 'user_login',
      summary: 'Logged in',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing summary', () => {
    const result = activityEventCreateSchema.safeParse({ type: 'task_created' });
    expect(result.success).toBe(false);
  });

  it('rejects empty summary', () => {
    const result = activityEventCreateSchema.safeParse({ type: 'task_created', summary: '' });
    expect(result.success).toBe(false);
  });
});
