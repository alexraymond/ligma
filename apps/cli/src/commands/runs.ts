import { type ActiveRun, apiPath } from '@ligma/api';
import { daemonJson } from '../client.js';
import { printTable } from '../format.js';

export async function runsList(baseUrl: string, signal?: AbortSignal): Promise<void> {
  const res = await daemonJson<{ runs: ActiveRun[] }>(baseUrl, apiPath('runs'), { signal });

  if (res.runs.length === 0) {
    console.log('No active runs.');
    return;
  }

  const rows = res.runs.map((r) => [r.id, r.taskId, r.status, r.startedAt]);
  printTable(['ID', 'TASK', 'STATUS', 'STARTED'], rows);
}
