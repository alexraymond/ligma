/**
 * Design systems IPC — channels that back the hub's Design Systems tab and
 * the per-design DesignSystemPicker in the Sidebar.
 *
 * Channels: designSystems:v1:{list,scan,rename,delete,linkToDesign}.
 *
 * The `db` argument is injected so tests can pass an in-memory instance.
 */

import { basename } from 'node:path';
import type { Design, DesignSystemRow } from '@ligma/shared';
import { CodesignError } from '@ligma/shared';
import type BetterSqlite3 from 'better-sqlite3';
import { scanDesignSystem } from './design-system';
import { ipcMain } from './electron-runtime';
import {
  createDesignSystem,
  deleteDesignSystem,
  linkDesignSystemToDesign,
  listDesignSystems,
  renameDesignSystem,
} from './snapshots-db';

type Database = BetterSqlite3.Database;

function requireSchemaV1(r: Record<string, unknown>, channel: string): void {
  if (r['schemaVersion'] !== 1) {
    throw new CodesignError(`${channel} requires schemaVersion: 1`, 'IPC_BAD_INPUT');
  }
}

function requireString(r: Record<string, unknown>, key: string): string {
  const v = r[key];
  if (typeof v !== 'string' || v.trim().length === 0) {
    throw new CodesignError(`${key} must be a non-empty string`, 'IPC_BAD_INPUT');
  }
  return v;
}

export function registerDesignSystemsIpc(db: Database): void {
  ipcMain.handle('designSystems:v1:list', (_e: unknown, raw: unknown): DesignSystemRow[] => {
    if (typeof raw !== 'object' || raw === null) {
      throw new CodesignError('designSystems:v1:list expects an object payload', 'IPC_BAD_INPUT');
    }
    requireSchemaV1(raw as Record<string, unknown>, 'designSystems:v1:list');
    return listDesignSystems(db);
  });

  ipcMain.handle(
    'designSystems:v1:scan',
    async (_e: unknown, raw: unknown): Promise<DesignSystemRow> => {
      if (typeof raw !== 'object' || raw === null) {
        throw new CodesignError('designSystems:v1:scan expects an object payload', 'IPC_BAD_INPUT');
      }
      const r = raw as Record<string, unknown>;
      requireSchemaV1(r, 'designSystems:v1:scan');
      const rootPath = requireString(r, 'rootPath');
      const name =
        typeof r['name'] === 'string' && r['name'].trim().length > 0
          ? (r['name'] as string)
          : basename(rootPath);
      const scan = await scanDesignSystem(rootPath);
      return createDesignSystem(db, {
        name,
        rootPath,
        summary: scan.summary,
        extractedAt: scan.extractedAt,
        sourceFiles: scan.sourceFiles,
        colors: scan.colors,
        fonts: scan.fonts,
        spacing: scan.spacing,
        radius: scan.radius,
        shadows: scan.shadows,
      });
    },
  );

  ipcMain.handle('designSystems:v1:rename', (_e: unknown, raw: unknown): DesignSystemRow => {
    if (typeof raw !== 'object' || raw === null) {
      throw new CodesignError('designSystems:v1:rename expects an object payload', 'IPC_BAD_INPUT');
    }
    const r = raw as Record<string, unknown>;
    requireSchemaV1(r, 'designSystems:v1:rename');
    return renameDesignSystem(db, requireString(r, 'id'), requireString(r, 'name'));
  });

  ipcMain.handle('designSystems:v1:delete', (_e: unknown, raw: unknown): void => {
    if (typeof raw !== 'object' || raw === null) {
      throw new CodesignError('designSystems:v1:delete expects an object payload', 'IPC_BAD_INPUT');
    }
    const r = raw as Record<string, unknown>;
    requireSchemaV1(r, 'designSystems:v1:delete');
    deleteDesignSystem(db, requireString(r, 'id'));
  });

  ipcMain.handle('designSystems:v1:link-to-design', (_e: unknown, raw: unknown): Design => {
    if (typeof raw !== 'object' || raw === null) {
      throw new CodesignError(
        'designSystems:v1:link-to-design expects an object payload',
        'IPC_BAD_INPUT',
      );
    }
    const r = raw as Record<string, unknown>;
    requireSchemaV1(r, 'designSystems:v1:link-to-design');
    const designId = requireString(r, 'designId');
    const dsId = r['designSystemId'];
    if (dsId !== null && (typeof dsId !== 'string' || dsId.trim().length === 0)) {
      throw new CodesignError('designSystemId must be a non-empty string or null', 'IPC_BAD_INPUT');
    }
    return linkDesignSystemToDesign(db, designId, dsId as string | null);
  });
}
