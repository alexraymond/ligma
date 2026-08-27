import { type Project, type Task, apiPath } from '@ligma/api';
import { daemonJson } from '../client.js';
import { printTable } from '../format.js';

/** Big enough to cover every project's tasks in a single-user local install without paging. */
const ALL = '?limit=1000';

export async function projectsList(baseUrl: string, signal?: AbortSignal): Promise<void> {
  const [projectsRes, tasksRes] = await Promise.all([
    daemonJson<{ projects: Project[] }>(baseUrl, `${apiPath('projects')}${ALL}`, { signal }),
    daemonJson<{ tasks: Task[] }>(baseUrl, `${apiPath('tasks')}${ALL}`, { signal }),
  ]);

  if (projectsRes.projects.length === 0) {
    console.log('No projects.');
    return;
  }

  const taskCounts = new Map<string, number>();
  for (const task of tasksRes.tasks) {
    if (!task.projectId) continue;
    taskCounts.set(task.projectId, (taskCounts.get(task.projectId) ?? 0) + 1);
  }

  const rows = projectsRes.projects.map((p) => [
    p.id,
    p.name,
    p.status,
    String(taskCounts.get(p.id) ?? 0),
  ]);
  printTable(['ID', 'NAME', 'STATUS', 'TASKS'], rows);
}
