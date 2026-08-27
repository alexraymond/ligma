import fs from 'node:fs/promises';
import path from 'node:path';

import { DATA_DIR } from '../src/paths';

// Backup and restore data files for test isolation
export async function backupDataFiles(): Promise<Record<string, string>> {
  const files = await fs.readdir(DATA_DIR);
  const backups: Record<string, string> = {};
  for (const file of files) {
    if (file.endsWith('.json') || file.endsWith('.md')) {
      backups[file] = await fs.readFile(path.join(DATA_DIR, file), 'utf-8');
    }
  }
  return backups;
}

export async function restoreDataFiles(backups: Record<string, string>): Promise<void> {
  for (const [file, content] of Object.entries(backups)) {
    await fs.writeFile(path.join(DATA_DIR, file), content, 'utf-8');
  }
}

// Helper to make test task payloads
export function createTestTask(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Test Task',
    description: 'A test task',
    importance: 'important' as const,
    urgency: 'urgent' as const,
    kanban: 'not-started' as const,
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
    tags: [],
    notes: '',
    ...overrides,
  };
}

export function createTestGoal(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Test Goal',
    type: 'long-term' as const,
    timeframe: 'Q1 2026',
    parentGoalId: null,
    projectId: null,
    status: 'not-started' as const,
    milestones: [],
    tasks: [],
    ...overrides,
  };
}

export function createTestProject(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Test Project',
    description: 'A test project',
    status: 'active' as const,
    color: '#3b82f6',
    teamMembers: [],
    tags: [],
    ...overrides,
  };
}
