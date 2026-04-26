import {
  type ExporterFormat,
  type MultiFileBundleEntry,
  exportArtifact,
  exportMultiFileBundle,
} from '@ligma/exporters';
import { CodesignError, ERROR_CODES } from '@ligma/shared';
import type { BrowserWindow } from 'electron';
import { dialog, ipcMain } from './electron-runtime';

const FORMAT_FILTERS: Record<ExporterFormat, Electron.FileFilter[]> = {
  html: [{ name: 'HTML', extensions: ['html'] }],
  pdf: [{ name: 'PDF', extensions: ['pdf'] }],
  pptx: [{ name: 'PowerPoint', extensions: ['pptx'] }],
  zip: [{ name: 'ZIP archive', extensions: ['zip'] }],
  markdown: [{ name: 'Markdown', extensions: ['md'] }],
};

export interface ExportRequest {
  format: ExporterFormat;
  htmlContent: string;
  defaultFilename?: string;
}

export interface ExportResponse {
  status: 'saved' | 'cancelled';
  path?: string;
  bytes?: number;
}

export function parseRequest(raw: unknown): ExportRequest {
  if (raw === null || typeof raw !== 'object') {
    throw new CodesignError('export expects an object payload', ERROR_CODES.IPC_BAD_INPUT);
  }
  const r = raw as Record<string, unknown>;
  const format = r['format'];
  const html = r['htmlContent'];
  const defaultFilename = r['defaultFilename'];
  if (
    format !== 'html' &&
    format !== 'pdf' &&
    format !== 'pptx' &&
    format !== 'zip' &&
    format !== 'markdown'
  ) {
    throw new CodesignError(
      `Unknown export format: ${String(format)}`,
      ERROR_CODES.EXPORTER_UNKNOWN,
    );
  }
  if (typeof html !== 'string' || html.length === 0) {
    throw new CodesignError('export requires non-empty htmlContent', ERROR_CODES.IPC_BAD_INPUT);
  }
  const out: ExportRequest = { format, htmlContent: html };
  if (typeof defaultFilename === 'string' && defaultFilename.length > 0) {
    out.defaultFilename = defaultFilename;
  }
  return out;
}

interface ExportMultiFileRequest {
  schemaVersion: 1;
  entries: MultiFileBundleEntry[];
  defaultFilename?: string;
}

export function parseMultiFileRequest(raw: unknown): ExportMultiFileRequest {
  if (raw === null || typeof raw !== 'object') {
    throw new CodesignError(
      'export-multi-file expects an object payload',
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  const r = raw as Record<string, unknown>;
  if (r['schemaVersion'] !== 1) {
    throw new CodesignError(
      'export-multi-file requires schemaVersion: 1',
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  const entriesRaw = r['entries'];
  if (!Array.isArray(entriesRaw) || entriesRaw.length === 0) {
    throw new CodesignError(
      'export-multi-file entries must be a non-empty array',
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  const entries: MultiFileBundleEntry[] = entriesRaw.map((e, idx) => {
    if (e === null || typeof e !== 'object') {
      throw new CodesignError(
        `export-multi-file entries[${idx}] must be an object`,
        ERROR_CODES.IPC_BAD_INPUT,
      );
    }
    const entry = e as Record<string, unknown>;
    if (typeof entry['path'] !== 'string' || entry['path'].length === 0) {
      throw new CodesignError(
        `export-multi-file entries[${idx}].path must be non-empty`,
        ERROR_CODES.IPC_BAD_INPUT,
      );
    }
    if (typeof entry['content'] !== 'string') {
      throw new CodesignError(
        `export-multi-file entries[${idx}].content must be a string`,
        ERROR_CODES.IPC_BAD_INPUT,
      );
    }
    return { path: entry['path'], content: entry['content'] };
  });
  const out: ExportMultiFileRequest = { schemaVersion: 1, entries };
  if (typeof r['defaultFilename'] === 'string' && (r['defaultFilename'] as string).length > 0) {
    out.defaultFilename = r['defaultFilename'] as string;
  }
  return out;
}

export function registerExporterIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(
    'export-multi-file:v1:bundle',
    async (_evt, raw: unknown): Promise<ExportResponse> => {
      const req = parseMultiFileRequest(raw);
      const win = getWindow();
      const opts: Electron.SaveDialogOptions = {
        title: 'Export project as ZIP bundle',
        defaultPath: req.defaultFilename ?? 'project.zip',
        filters: FORMAT_FILTERS.zip,
      };
      const picked = win
        ? await dialog.showSaveDialog(win, opts)
        : await dialog.showSaveDialog(opts);
      if (picked.canceled || !picked.filePath) {
        return { status: 'cancelled' };
      }
      const result = await exportMultiFileBundle(req.entries, picked.filePath);
      return { status: 'saved', path: result.path, bytes: result.bytes };
    },
  );

  ipcMain.handle('codesign:export', async (_evt, raw: unknown): Promise<ExportResponse> => {
    const req = parseRequest(raw);
    const win = getWindow();
    const defaultExt = req.format === 'markdown' ? 'md' : req.format;
    const opts: Electron.SaveDialogOptions = {
      title: `Export design as ${req.format.toUpperCase()}`,
      defaultPath: req.defaultFilename ?? `design.${defaultExt}`,
      filters: FORMAT_FILTERS[req.format],
    };
    const picked = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (picked.canceled || !picked.filePath) {
      return { status: 'cancelled' };
    }

    // All four formats ship in tier 1; the heavy deps load lazily inside
    // exportArtifact. Errors propagate to the renderer as toasts (PRINCIPLES §10).
    const result = await exportArtifact(req.format, req.htmlContent, picked.filePath);
    return { status: 'saved', path: result.path, bytes: result.bytes };
  });
}
