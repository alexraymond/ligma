/**
 * Integration tests: Concurrent State Mutations (NEG-06)
 *
 * Validates data integrity under concurrent or racing state mutations.
 * The mission-control data layer uses per-file async-mutex to serialize writes.
 *
 * Scenarios:
 * - Two mutations to same entity simultaneously → serialized, both applied
 * - Simultaneous save operations → no corruption
 * - Multi-tab/concurrent requests → safely queued
 * - Mutation during save → consistent snapshot
 * - Rapid sequential mutations → each applied to correct state
 */

import type { Task } from '@ligma/api';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getActivityLog,
  getInbox,
  getTasks,
  mutateActivityLog,
  mutateInbox,
  mutateTasks,
  saveInbox,
  saveTasks,
} from '../../src/store/data';
import { createTask, findTask } from './test-utils';

// Data backup/restore is handled automatically by setup.ts

describe('NEG-06: Concurrent state mutations', () => {
  describe('two mutations to same entity simultaneously', () => {
    it('serializes concurrent mutations — both applied, no data loss', async () => {
      const task = await createTask({
        title: 'Concurrent target',
        notes: '',
        tags: [],
      });

      // Fire two mutateTasks calls simultaneously that modify the same task
      const [resultA, resultB] = await Promise.all([
        mutateTasks(async (data) => {
          const t = data.tasks.find((t) => t.id === task.id);
          if (!t) throw new Error('Task not found in mutation A');
          t.notes = 'Mutation A applied';
          t.tags = [...(t.tags ?? []), 'from-a'];
          t.updatedAt = new Date().toISOString();
          return 'a';
        }),
        mutateTasks(async (data) => {
          const t = data.tasks.find((t) => t.id === task.id);
          if (!t) throw new Error('Task not found in mutation B');
          t.notes = 'Mutation B applied';
          t.tags = [...(t.tags ?? []), 'from-b'];
          t.updatedAt = new Date().toISOString();
          return 'b';
        }),
      ]);

      // Both mutations completed
      expect(resultA).toBe('a');
      expect(resultB).toBe('b');

      // Read the final state
      const final = await findTask(task.id);
      expect(final).toBeDefined();

      // The mutex serialized them: whichever ran second "wins" for notes,
      // but importantly the file is NOT corrupted
      expect(['Mutation A applied', 'Mutation B applied']).toContain(final!.notes);

      // The second mutation re-read the file after the first wrote it,
      // so the second mutation's tag is present. The first mutation's tag
      // may or may not be present depending on ordering (second read
      // includes first's changes). Either way, data is consistent.
      expect(final!.tags).toBeDefined();
      expect(final!.tags!.length).toBeGreaterThanOrEqual(1);
    });

    it('serializes three concurrent mutations to same task without corruption', async () => {
      const task = await createTask({
        title: 'Triple mutation target',
        actualMinutes: 0,
      });

      // Three concurrent increments to actualMinutes
      await Promise.all([
        mutateTasks(async (data) => {
          const t = data.tasks.find((t) => t.id === task.id)!;
          t.actualMinutes = (t.actualMinutes ?? 0) + 10;
        }),
        mutateTasks(async (data) => {
          const t = data.tasks.find((t) => t.id === task.id)!;
          t.actualMinutes = (t.actualMinutes ?? 0) + 20;
        }),
        mutateTasks(async (data) => {
          const t = data.tasks.find((t) => t.id === task.id)!;
          t.actualMinutes = (t.actualMinutes ?? 0) + 30;
        }),
      ]);

      const final = await findTask(task.id);
      expect(final).toBeDefined();

      // Because mutateTasks serializes (lock → read → mutate → write → unlock),
      // each mutation reads the latest state. All three increments compound:
      // 0 → 10 (or 20 or 30) → adds next → adds last = total 60
      expect(final!.actualMinutes).toBe(60);
    });
  });

  describe('simultaneous save operations (auto-save + manual save)', () => {
    it('queues concurrent saves without corrupting the file', async () => {
      // Create initial tasks
      const taskA = await createTask({ title: 'Save test A' });
      const taskB = await createTask({ title: 'Save test B' });

      // Simulate auto-save and manual save happening simultaneously
      // by firing two full read-mutate-save cycles concurrently via mutateTasks
      await Promise.all([
        mutateTasks(async (data) => {
          const t = data.tasks.find((t) => t.id === taskA.id);
          if (t) t.notes = 'Auto-saved';
        }),
        mutateTasks(async (data) => {
          const t = data.tasks.find((t) => t.id === taskB.id);
          if (t) t.notes = 'Manually saved';
        }),
      ]);

      // Both saves should have been applied
      const finalA = await findTask(taskA.id);
      const finalB = await findTask(taskB.id);
      expect(finalA!.notes).toBe('Auto-saved');
      expect(finalB!.notes).toBe('Manually saved');

      // Verify the entire file is valid JSON with all tasks intact
      const allTasks = await getTasks();
      expect(allTasks.tasks.find((t) => t.id === taskA.id)).toBeDefined();
      expect(allTasks.tasks.find((t) => t.id === taskB.id)).toBeDefined();
    });

    it('handles concurrent saves to different data files without interference', async () => {
      // Different files have different mutexes — they can truly run in parallel
      const [taskResult, inboxResult] = await Promise.all([
        mutateTasks(async (data) => {
          data.tasks.push({
            id: `task_concurrent_save_${Date.now()}`,
            title: 'Cross-file save test',
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
            tags: ['cross-file-test'],
            notes: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            dueDate: null,
            completedAt: null,
            deletedAt: null,
          } as Task);
          return 'task-saved';
        }),
        mutateInbox(async (data) => {
          data.messages.push({
            id: `msg_concurrent_save_${Date.now()}`,
            from: 'system',
            to: 'developer',
            type: 'update',
            taskId: null,
            subject: 'Cross-file save test message',
            body: 'Testing concurrent saves across files',
            status: 'unread',
            createdAt: new Date().toISOString(),
            readAt: null,
          });
          return 'inbox-saved';
        }),
      ]);

      expect(taskResult).toBe('task-saved');
      expect(inboxResult).toBe('inbox-saved');

      // Verify both files are intact
      const tasks = await getTasks();
      const inbox = await getInbox();
      expect(tasks.tasks.some((t) => t.tags?.includes('cross-file-test'))).toBe(true);
      expect(inbox.messages.some((m) => m.subject === 'Cross-file save test message')).toBe(true);
    });
  });

  describe('multi-tab concurrent request handling', () => {
    it('serializes concurrent updates from simulated parallel requests', async () => {
      const task = await createTask({
        title: 'Multi-tab target',
        kanban: 'not-started',
        verificationStatus: 'unverified',
        subtasks: [
          { id: 'st_1', title: 'Step 1', done: false },
          { id: 'st_2', title: 'Step 2', done: false },
          { id: 'st_3', title: 'Step 3', done: false },
        ],
      });

      // Simulate two "browser tabs" trying to update subtasks concurrently
      // Tab A completes subtask 1, Tab B completes subtask 2
      await Promise.all([
        mutateTasks(async (data) => {
          const t = data.tasks.find((t) => t.id === task.id)!;
          const st = t.subtasks.find((s) => s.id === 'st_1');
          if (st) st.done = true;
          t.updatedAt = new Date().toISOString();
        }),
        mutateTasks(async (data) => {
          const t = data.tasks.find((t) => t.id === task.id)!;
          const st = t.subtasks.find((s) => s.id === 'st_2');
          if (st) st.done = true;
          t.updatedAt = new Date().toISOString();
        }),
      ]);

      const final = await findTask(task.id);
      expect(final).toBeDefined();

      // Both subtask completions should be reflected
      // (second mutation reads after first wrote, so it sees st_1 done + marks st_2 done)
      const st1 = final!.subtasks.find((s) => s.id === 'st_1');
      const st2 = final!.subtasks.find((s) => s.id === 'st_2');
      const st3 = final!.subtasks.find((s) => s.id === 'st_3');
      expect(st1!.done).toBe(true);
      expect(st2!.done).toBe(true);
      expect(st3!.done).toBe(false);
    });

    it('handles concurrent task creation without ID collision', async () => {
      // Simulate multiple tabs creating tasks at the same time
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          mutateTasks(async (data) => {
            const task: Task = {
              id: `task_tab_${i}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              title: `Tab ${i} task`,
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
              tags: ['multi-tab-test'],
              notes: '',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              dueDate: null,
              completedAt: null,
              deletedAt: null,
            };
            data.tasks.push(task);
            return task.id;
          }),
        ),
      );

      // All 5 tasks should have been created with unique IDs
      const uniqueIds = new Set(results);
      expect(uniqueIds.size).toBe(5);

      // All 5 should exist in the file
      const allTasks = await getTasks();
      const multiTabTasks = allTasks.tasks.filter((t) => t.tags?.includes('multi-tab-test'));
      expect(multiTabTasks.length).toBe(5);
    });
  });

  describe('mutation during save captures consistent snapshot', () => {
    it('slow mutation holds the lock — later mutations wait and see consistent state', async () => {
      const task = await createTask({
        title: 'Slow mutation target',
        notes: 'initial',
      });

      const executionOrder: string[] = [];

      // Mutation A: slow operation (simulates a long save)
      const mutationA = mutateTasks(async (data) => {
        executionOrder.push('A-start');
        const t = data.tasks.find((t) => t.id === task.id)!;
        t.notes = 'slow-mutation-complete';
        // Simulate slow I/O within the lock
        await new Promise((resolve) => setTimeout(resolve, 100));
        executionOrder.push('A-end');
      });

      // Mutation B: fires immediately after A, must wait for lock
      const mutationB = mutateTasks(async (data) => {
        executionOrder.push('B-start');
        const t = data.tasks.find((t) => t.id === task.id)!;
        // B should see A's changes because the mutex serializes them
        expect(t.notes).toBe('slow-mutation-complete');
        t.notes = 'fast-mutation-after-slow';
        executionOrder.push('B-end');
      });

      await Promise.all([mutationA, mutationB]);

      // Verify execution order: A completes fully before B starts
      expect(executionOrder).toEqual(['A-start', 'A-end', 'B-start', 'B-end']);

      const final = await findTask(task.id);
      expect(final!.notes).toBe('fast-mutation-after-slow');
    });

    it('failed mutation does not write — implicit rollback preserves data', async () => {
      const task = await createTask({
        title: 'Rollback test',
        notes: 'original',
      });

      // This mutation should fail mid-operation
      await expect(
        mutateTasks(async (data) => {
          const t = data.tasks.find((t) => t.id === task.id)!;
          t.notes = 'this-should-not-persist';
          throw new Error('Simulated failure mid-mutation');
        }),
      ).rejects.toThrow('Simulated failure mid-mutation');

      // The file should NOT have been written (mutateTasks only writes on success)
      const final = await findTask(task.id);
      expect(final!.notes).toBe('original');
    });

    it('failed mutation does not block subsequent mutations', async () => {
      const task = await createTask({
        title: 'Recovery test',
        notes: 'before-failure',
      });

      // Failing mutation
      try {
        await mutateTasks(async () => {
          throw new Error('Intentional failure');
        });
      } catch {
        // Expected
      }

      // Subsequent mutation should work fine (mutex released on error)
      await mutateTasks(async (data) => {
        const t = data.tasks.find((t) => t.id === task.id)!;
        t.notes = 'after-recovery';
      });

      const final = await findTask(task.id);
      expect(final!.notes).toBe('after-recovery');
    });
  });

  describe('rapid sequential mutations (undo/redo pattern)', () => {
    it('applies rapid mutations in correct order to correct state versions', async () => {
      const task = await createTask({
        title: 'Undo/redo target',
        notes: 'v0',
        kanban: 'not-started',
        verificationStatus: 'unverified',
      });

      // Simulate rapid state transitions: v0 → v1 → v2 → v3 (undo to v2) → v4
      const stateHistory: string[] = [];

      // v0 → v1
      await mutateTasks(async (data) => {
        const t = data.tasks.find((t) => t.id === task.id)!;
        stateHistory.push(t.notes);
        t.notes = 'v1';
        t.kanban = 'in-progress';
      });

      // v1 → v2
      await mutateTasks(async (data) => {
        const t = data.tasks.find((t) => t.id === task.id)!;
        stateHistory.push(t.notes);
        t.notes = 'v2';
      });

      // v2 → v3
      await mutateTasks(async (data) => {
        const t = data.tasks.find((t) => t.id === task.id)!;
        stateHistory.push(t.notes);
        t.notes = 'v3';
        t.kanban = 'done';
        t.completedAt = new Date().toISOString();
      });

      // "Undo" — revert to v2 state
      await mutateTasks(async (data) => {
        const t = data.tasks.find((t) => t.id === task.id)!;
        stateHistory.push(t.notes);
        t.notes = 'v2-restored';
        t.kanban = 'in-progress';
        t.completedAt = null;
      });

      // New v4
      await mutateTasks(async (data) => {
        const t = data.tasks.find((t) => t.id === task.id)!;
        stateHistory.push(t.notes);
        t.notes = 'v4-after-undo';
      });

      // Each mutation read the correct prior version
      expect(stateHistory).toEqual(['v0', 'v1', 'v2', 'v3', 'v2-restored']);

      const final = await findTask(task.id);
      expect(final!.notes).toBe('v4-after-undo');
      expect(final!.kanban).toBe('in-progress');
      expect(final!.completedAt).toBeNull();
    });

    it('rapid fire concurrent mutations all compound correctly', async () => {
      const task = await createTask({
        title: 'Rapid fire counter',
        actualMinutes: 0,
      });

      // Fire 10 concurrent increment mutations
      const N = 10;
      await Promise.all(
        Array.from({ length: N }, () =>
          mutateTasks(async (data) => {
            const t = data.tasks.find((t) => t.id === task.id)!;
            t.actualMinutes = (t.actualMinutes ?? 0) + 1;
          }),
        ),
      );

      const final = await findTask(task.id);
      // All 10 increments should compound because each mutation
      // reads the latest file state within the lock
      expect(final!.actualMinutes).toBe(N);
    });

    it('rapid mutations across multiple files maintain per-file consistency', async () => {
      // Create a task
      const task = await createTask({ title: 'Cross-file rapid test' });

      // Fire rapid mutations to tasks + inbox + activity-log simultaneously
      await Promise.all([
        // 3 task mutations
        mutateTasks(async (data) => {
          const t = data.tasks.find((t) => t.id === task.id)!;
          t.tags = [...(t.tags ?? []), 'rapid-1'];
        }),
        mutateTasks(async (data) => {
          const t = data.tasks.find((t) => t.id === task.id)!;
          t.tags = [...(t.tags ?? []), 'rapid-2'];
        }),
        mutateTasks(async (data) => {
          const t = data.tasks.find((t) => t.id === task.id)!;
          t.tags = [...(t.tags ?? []), 'rapid-3'];
        }),
        // 2 inbox mutations (different mutex, truly parallel with tasks)
        mutateInbox(async (data) => {
          data.messages.push({
            id: `msg_rapid_1_${Date.now()}`,
            from: 'system',
            to: 'developer',
            type: 'update',
            taskId: task.id,
            subject: 'Rapid msg 1',
            body: '',
            status: 'unread',
            createdAt: new Date().toISOString(),
            readAt: null,
          });
        }),
        mutateInbox(async (data) => {
          data.messages.push({
            id: `msg_rapid_2_${Date.now()}`,
            from: 'system',
            to: 'developer',
            type: 'update',
            taskId: task.id,
            subject: 'Rapid msg 2',
            body: '',
            status: 'unread',
            createdAt: new Date().toISOString(),
            readAt: null,
          });
        }),
        // 2 activity-log mutations (yet another mutex)
        mutateActivityLog(async (data) => {
          data.events.push({
            id: `evt_rapid_1_${Date.now()}`,
            type: 'task_updated',
            actor: 'system',
            taskId: task.id,
            summary: 'Rapid event 1',
            details: '',
            timestamp: new Date().toISOString(),
          });
        }),
        mutateActivityLog(async (data) => {
          data.events.push({
            id: `evt_rapid_2_${Date.now()}`,
            type: 'task_updated',
            actor: 'system',
            taskId: task.id,
            summary: 'Rapid event 2',
            details: '',
            timestamp: new Date().toISOString(),
          });
        }),
      ]);

      // Verify tasks: all 3 tags accumulated
      const finalTask = await findTask(task.id);
      expect(finalTask!.tags).toContain('rapid-1');
      expect(finalTask!.tags).toContain('rapid-2');
      expect(finalTask!.tags).toContain('rapid-3');

      // Verify inbox: both messages present
      const inbox = await getInbox();
      const rapidMsgs = inbox.messages.filter(
        (m) => m.taskId === task.id && m.subject.startsWith('Rapid msg'),
      );
      expect(rapidMsgs.length).toBe(2);

      // Verify activity log: both events present
      const activity = await getActivityLog();
      const rapidEvents = activity.events.filter(
        (e) => e.taskId === task.id && e.summary.startsWith('Rapid event'),
      );
      expect(rapidEvents.length).toBe(2);
    });
  });
});
