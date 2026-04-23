/**
 * Bidirectional permission bridge for the Claude Agent SDK's `canUseTool`.
 *
 * Flow:
 *   SDK tool call → providers/sdk-runtime adapter → host PermissionCallback
 *   → `requestPermission()` here → IPC `permissions:v1:request` → renderer
 *   modal → user picks allow/deny → IPC `permissions:v1:respond` → resolves
 *   the pending Promise → adapter converts to SDK PermissionResult.
 *
 * A pending request that doesn't get a response within `DEFAULT_TIMEOUT_MS`
 * auto-denies. Late responses for an already-resolved id are dropped.
 */

import {
  CodesignError,
  ERROR_CODES,
  type PermissionDecision,
  type PermissionRequest,
} from '@ligma/shared';
import type { BrowserWindow as ElectronBrowserWindow } from 'electron';
import { ipcMain } from './electron-runtime';
import { getLogger } from './logger';

const logger = getLogger('permissions-ipc');

interface PendingResolver {
  resolve: (decision: PermissionDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingResolver>();

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export interface RequestPermissionOptions {
  /** Window that hosts the permission modal. */
  window: ElectronBrowserWindow;
  /** Override the auto-deny timeout (test-only). */
  timeoutMs?: number;
}

export function requestPermission(
  request: PermissionRequest,
  opts: RequestPermissionOptions,
): Promise<PermissionDecision> {
  return new Promise((resolve, reject) => {
    if (opts.window.isDestroyed()) {
      reject(
        new CodesignError(
          'Cannot request permission: window has been destroyed.',
          ERROR_CODES.IPC_BAD_INPUT,
        ),
      );
      return;
    }

    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => {
      pending.delete(request.requestId);
      logger.warn('permission.timeout', {
        requestId: request.requestId,
        toolName: request.toolName,
        timeoutMs,
      });
      resolve({
        requestId: request.requestId,
        behavior: 'deny',
        message: `User did not respond within ${Math.round(timeoutMs / 1000)}s — auto-denied.`,
      });
    }, timeoutMs);

    pending.set(request.requestId, { resolve, timer });
    opts.window.webContents.send('permissions:v1:request', request);
  });
}

let registered = false;

export function registerPermissionsIpc(): void {
  if (registered) return;
  registered = true;
  ipcMain.on('permissions:v1:respond', (_event, raw: unknown) => {
    if (typeof raw !== 'object' || raw === null) return;
    const decision = raw as PermissionDecision;
    if (typeof decision.requestId !== 'string') return;
    if (decision.behavior !== 'allow' && decision.behavior !== 'deny') return;
    const entry = pending.get(decision.requestId);
    if (!entry) return;
    pending.delete(decision.requestId);
    clearTimeout(entry.timer);
    entry.resolve(decision);
  });
}

export function clearPendingForTest(): void {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
  }
  pending.clear();
  registered = false;
}

export function pendingPermissionCountForTest(): number {
  return pending.size;
}
