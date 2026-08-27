import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectsList } from '../src/commands/projects';
import { type Handler, json, startMockDaemon } from './helpers';

describe('projects list', () => {
  let close: () => Promise<void>;
  let baseUrl: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  afterEach(async () => {
    logSpy.mockRestore();
    await close();
  });

  it('prints a table of projects with task counts joined from /api/tasks', async () => {
    const routes: Record<string, Handler> = {
      'GET /api/projects?limit=1000': (_req, res) =>
        json(res, 200, {
          projects: [
            { id: 'proj_1', name: 'Acme Docs Site', status: 'active' },
            { id: 'proj_2', name: 'Empty Co', status: 'paused' },
          ],
          meta: { total: 2 },
        }),
      'GET /api/tasks?limit=1000': (_req, res) =>
        json(res, 200, {
          tasks: [
            { id: 't1', projectId: 'proj_1' },
            { id: 't2', projectId: 'proj_1' },
            { id: 't3', projectId: null },
          ],
          meta: { total: 3 },
        }),
    };
    ({ baseUrl, close } = await startMockDaemon(routes));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await projectsList(baseUrl);

    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('proj_1');
    expect(output).toContain('Acme Docs Site');
    expect(output).toContain('2'); // task count for proj_1
    expect(output).toContain('proj_2');
    expect(output).toContain('0'); // task count for proj_2
  });

  it('prints a friendly message when there are no projects', async () => {
    const routes: Record<string, Handler> = {
      'GET /api/projects?limit=1000': (_req, res) => json(res, 200, { projects: [] }),
      'GET /api/tasks?limit=1000': (_req, res) => json(res, 200, { tasks: [] }),
    };
    ({ baseUrl, close } = await startMockDaemon(routes));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await projectsList(baseUrl);

    expect(logSpy).toHaveBeenCalledWith('No projects.');
  });
});
