/**
 * Per-design workspace IPC.
 *
 * The workspace is the cwd (and optional extra read-allowed directories)
 * forwarded to Claude's Agent SDK on each generate call, so its filesystem
 * tools see the user's project directory instead of Ligma's launch dir.
 *
 * v1 keeps the per-design workspace map in memory only. A future revision
 * (tracked separately) will persist it alongside design rows in SQLite so
 * the cwd survives restarts. The shape of `workspace:v1:get` / `:set` is
 * stable across that change — only the storage swaps.
 */

import { CodesignError, ERROR_CODES, type WorkspaceContext } from '@ligma/shared';
import { dialog, ipcMain } from './electron-runtime';
import { getLogger } from './logger';

const logger = getLogger('workspace-ipc');

const workspaces = new Map<string, WorkspaceContext>();

function parseDesignId(raw: unknown, channel: string): string {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError(`${channel} expects an object payload`, ERROR_CODES.IPC_BAD_INPUT);
  }
  const r = raw as Record<string, unknown>;
  if (r['schemaVersion'] !== 1) {
    throw new CodesignError(`${channel} requires schemaVersion: 1`, ERROR_CODES.IPC_BAD_INPUT);
  }
  if (typeof r['designId'] !== 'string' || r['designId'].trim().length === 0) {
    throw new CodesignError(`${channel} requires a non-empty designId`, ERROR_CODES.IPC_BAD_INPUT);
  }
  return r['designId'];
}

function parseWorkspace(raw: unknown): WorkspaceContext | null {
  if (raw === null) return null;
  if (typeof raw !== 'object') {
    throw new CodesignError('workspace must be an object or null', ERROR_CODES.IPC_BAD_INPUT);
  }
  const r = raw as Record<string, unknown>;
  const out: WorkspaceContext = {};
  if (r['cwd'] !== undefined) {
    if (typeof r['cwd'] !== 'string' || r['cwd'].trim().length === 0) {
      throw new CodesignError(
        'workspace.cwd must be a non-empty string',
        ERROR_CODES.IPC_BAD_INPUT,
      );
    }
    out.cwd = r['cwd'];
  }
  if (r['additionalDirectories'] !== undefined) {
    if (!Array.isArray(r['additionalDirectories'])) {
      throw new CodesignError(
        'workspace.additionalDirectories must be an array of strings',
        ERROR_CODES.IPC_BAD_INPUT,
      );
    }
    for (const dir of r['additionalDirectories']) {
      if (typeof dir !== 'string' || dir.trim().length === 0) {
        throw new CodesignError(
          'workspace.additionalDirectories entries must be non-empty strings',
          ERROR_CODES.IPC_BAD_INPUT,
        );
      }
    }
    out.additionalDirectories = r['additionalDirectories'] as string[];
  }
  return out;
}

let registered = false;

export function registerWorkspaceIpc(): void {
  if (registered) return;
  registered = true;

  ipcMain.handle('workspace:v1:get', async (_e, raw: unknown): Promise<WorkspaceContext | null> => {
    const designId = parseDesignId(raw, 'workspace:v1:get');
    return workspaces.get(designId) ?? null;
  });

  ipcMain.handle('workspace:v1:set', async (_e, raw: unknown): Promise<{ ok: true }> => {
    const designId = parseDesignId(raw, 'workspace:v1:set');
    if (typeof raw !== 'object' || raw === null) {
      throw new CodesignError('workspace:v1:set expects an object', ERROR_CODES.IPC_BAD_INPUT);
    }
    const workspace = parseWorkspace((raw as Record<string, unknown>)['workspace']);
    if (workspace === null) {
      workspaces.delete(designId);
      logger.info('workspace.clear', { designId });
    } else {
      workspaces.set(designId, workspace);
      logger.info('workspace.set', {
        designId,
        cwd: workspace.cwd ?? null,
        additionalCount: workspace.additionalDirectories?.length ?? 0,
      });
    }
    return { ok: true };
  });

  ipcMain.handle('workspace:v1:pickDirectory', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose workspace directory',
      message:
        'Pick the directory Claude can read from while working on this design. Files outside it stay private.',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const picked = result.filePaths[0];
    return picked ?? null;
  });
}

export function clearWorkspacesForTest(): void {
  workspaces.clear();
  registered = false;
}

export function getWorkspaceForTest(designId: string): WorkspaceContext | undefined {
  return workspaces.get(designId);
}
