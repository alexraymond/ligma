/**
 * Files IPC handlers (main process).
 *
 * Namespaced files:v1:* so the renderer can read and mutate the virtual FS
 * that backs the canvas tab bar. Channel shapes are validated by hand (same
 * pattern as snapshots-ipc) to avoid a zod import in the main bundle.
 *
 * The `db` argument is injected so tests can pass an in-memory instance.
 */

import type { DesignFile } from '@ligma/shared';
import { CodesignError } from '@ligma/shared';
import type BetterSqlite3 from 'better-sqlite3';
import { ipcMain } from './electron-runtime';
import {
  createDesignFile,
  deleteDesignFile,
  listDesignFiles,
  renameDesignFile,
  upsertDesignFile,
  viewDesignFile,
} from './snapshots-db';

type Database = BetterSqlite3.Database;

function requireSchemaV1(r: Record<string, unknown>, channel: string): void {
  if (r['schemaVersion'] !== 1) {
    throw new CodesignError(`${channel} requires schemaVersion: 1`, 'IPC_BAD_INPUT');
  }
}

function requireDesignId(r: Record<string, unknown>): string {
  if (typeof r['designId'] !== 'string' || r['designId'].trim().length === 0) {
    throw new CodesignError('designId must be a non-empty string', 'IPC_BAD_INPUT');
  }
  return r['designId'] as string;
}

function requirePath(r: Record<string, unknown>, key = 'path'): string {
  const v = r[key];
  if (typeof v !== 'string' || v.trim().length === 0) {
    throw new CodesignError(`${key} must be a non-empty string`, 'IPC_BAD_INPUT');
  }
  return v;
}

export function registerDesignFilesIpc(db: Database): void {
  ipcMain.handle('files:v1:list', (_e: unknown, raw: unknown): DesignFile[] => {
    if (typeof raw !== 'object' || raw === null) {
      throw new CodesignError('files:v1:list expects an object payload', 'IPC_BAD_INPUT');
    }
    const r = raw as Record<string, unknown>;
    requireSchemaV1(r, 'files:v1:list');
    const designId = requireDesignId(r);
    return listDesignFiles(db, designId);
  });

  ipcMain.handle('files:v1:read', (_e: unknown, raw: unknown): DesignFile | null => {
    if (typeof raw !== 'object' || raw === null) {
      throw new CodesignError('files:v1:read expects an object payload', 'IPC_BAD_INPUT');
    }
    const r = raw as Record<string, unknown>;
    requireSchemaV1(r, 'files:v1:read');
    return viewDesignFile(db, requireDesignId(r), requirePath(r));
  });

  ipcMain.handle('files:v1:create', (_e: unknown, raw: unknown): DesignFile => {
    if (typeof raw !== 'object' || raw === null) {
      throw new CodesignError('files:v1:create expects an object payload', 'IPC_BAD_INPUT');
    }
    const r = raw as Record<string, unknown>;
    requireSchemaV1(r, 'files:v1:create');
    const content = typeof r['content'] === 'string' ? (r['content'] as string) : '';
    return createDesignFile(db, requireDesignId(r), requirePath(r), content);
  });

  ipcMain.handle('files:v1:upsert', (_e: unknown, raw: unknown): DesignFile => {
    if (typeof raw !== 'object' || raw === null) {
      throw new CodesignError('files:v1:upsert expects an object payload', 'IPC_BAD_INPUT');
    }
    const r = raw as Record<string, unknown>;
    requireSchemaV1(r, 'files:v1:upsert');
    const content = typeof r['content'] === 'string' ? (r['content'] as string) : '';
    return upsertDesignFile(db, requireDesignId(r), requirePath(r), content);
  });

  ipcMain.handle('files:v1:rename', (_e: unknown, raw: unknown): DesignFile => {
    if (typeof raw !== 'object' || raw === null) {
      throw new CodesignError('files:v1:rename expects an object payload', 'IPC_BAD_INPUT');
    }
    const r = raw as Record<string, unknown>;
    requireSchemaV1(r, 'files:v1:rename');
    return renameDesignFile(
      db,
      requireDesignId(r),
      requirePath(r, 'fromPath'),
      requirePath(r, 'toPath'),
    );
  });

  ipcMain.handle('files:v1:delete', (_e: unknown, raw: unknown): void => {
    if (typeof raw !== 'object' || raw === null) {
      throw new CodesignError('files:v1:delete expects an object payload', 'IPC_BAD_INPUT');
    }
    const r = raw as Record<string, unknown>;
    requireSchemaV1(r, 'files:v1:delete');
    deleteDesignFile(db, requireDesignId(r), requirePath(r));
  });
}
