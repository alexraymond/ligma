import type { Task, VerificationStatus } from '@ligma/api';
import { describe, expect, it } from 'vitest';
import { stillUnproven } from './unproven';

function task(id: string, verificationStatus?: VerificationStatus): Task {
  return {
    id,
    title: id,
    description: '',
    importance: 'important',
    urgency: 'urgent',
    kanban: 'not-started',
    ...(verificationStatus ? { verificationStatus } : {}),
    projectId: 'proj',
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
    dueDate: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    completedAt: null,
    deletedAt: null,
  } as Task;
}

describe('stillUnproven', () => {
  it('keeps unverified and failed tasks', () => {
    const list = stillUnproven([task('a', 'unverified'), task('b', 'failed')]);
    expect(list.map((t) => t.id).sort()).toEqual(['a', 'b']);
  });

  it('drops passed and waived — waived is a decision on the record, not an open question', () => {
    expect(stillUnproven([task('a', 'passed'), task('b', 'waived')])).toEqual([]);
  });

  it('treats a missing verificationStatus as unproven, not as proven', () => {
    expect(stillUnproven([task('a')]).map((t) => t.id)).toEqual(['a']);
  });

  it('sorts failed above unverified', () => {
    expect(stillUnproven([task('a', 'unverified'), task('b', 'failed')]).map((t) => t.id)).toEqual([
      'b',
      'a',
    ]);
  });

  it('is empty when everything is proven', () => {
    expect(stillUnproven([task('a', 'passed')])).toEqual([]);
  });
});
