import type { PermissionDecision, PermissionRequest } from '@ligma/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sentMessages: Array<{ channel: string; payload: unknown }> = [];
const respondHandlers: Array<(event: unknown, raw: unknown) => void> = [];

vi.mock('./electron-runtime', () => ({
  ipcMain: {
    on: (channel: string, handler: (event: unknown, raw: unknown) => void) => {
      if (channel === 'permissions:v1:respond') respondHandlers.push(handler);
    },
  },
}));

vi.mock('./logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  clearPendingForTest,
  pendingPermissionCountForTest,
  registerPermissionsIpc,
  requestPermission,
} from './permissions-ipc';

interface FakeWindow {
  isDestroyed: () => boolean;
  webContents: { send: (channel: string, payload: unknown) => void };
}

function makeWindow(destroyed = false): FakeWindow {
  return {
    isDestroyed: () => destroyed,
    webContents: {
      send: (channel: string, payload: unknown) => {
        sentMessages.push({ channel, payload });
      },
    },
  };
}

function makeRequest(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    requestId: 'req_1',
    toolName: 'Read',
    input: { path: '/Users/alice/foo' },
    ...overrides,
  };
}

function deliverResponse(decision: PermissionDecision): void {
  for (const handler of respondHandlers) handler({}, decision);
}

beforeEach(() => {
  clearPendingForTest();
  sentMessages.length = 0;
  respondHandlers.length = 0;
  registerPermissionsIpc();
});

afterEach(() => {
  clearPendingForTest();
});

describe('requestPermission', () => {
  it('forwards the request to the window and resolves on matching response', async () => {
    const win = makeWindow();
    const request = makeRequest();
    const promise = requestPermission(request, {
      window: win as unknown as Parameters<typeof requestPermission>[1]['window'],
    });

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toEqual({
      channel: 'permissions:v1:request',
      payload: request,
    });
    expect(pendingPermissionCountForTest()).toBe(1);

    deliverResponse({
      requestId: 'req_1',
      behavior: 'allow',
    });
    const decision = await promise;
    expect(decision).toEqual({ requestId: 'req_1', behavior: 'allow' });
    expect(pendingPermissionCountForTest()).toBe(0);
  });

  it('ignores responses for unknown request ids', async () => {
    const win = makeWindow();
    const promise = requestPermission(makeRequest({ requestId: 'r_a' }), {
      window: win as unknown as Parameters<typeof requestPermission>[1]['window'],
    });
    deliverResponse({ requestId: 'r_other', behavior: 'allow' });
    expect(pendingPermissionCountForTest()).toBe(1);

    deliverResponse({ requestId: 'r_a', behavior: 'deny', message: 'no thanks' });
    const decision = await promise;
    expect(decision).toEqual({
      requestId: 'r_a',
      behavior: 'deny',
      message: 'no thanks',
    });
  });

  it('auto-denies after the configured timeout', async () => {
    vi.useFakeTimers();
    const win = makeWindow();
    const promise = requestPermission(makeRequest(), {
      window: win as unknown as Parameters<typeof requestPermission>[1]['window'],
      timeoutMs: 100,
    });

    vi.advanceTimersByTime(101);
    const decision = await promise;
    expect(decision.behavior).toBe('deny');
    expect(decision.message).toMatch(/auto-denied/);
    expect(pendingPermissionCountForTest()).toBe(0);
    vi.useRealTimers();
  });

  it('rejects when the window is already destroyed', async () => {
    const win = makeWindow(true);
    await expect(
      requestPermission(makeRequest(), {
        window: win as unknown as Parameters<typeof requestPermission>[1]['window'],
      }),
    ).rejects.toThrow(/window has been destroyed/);
    expect(sentMessages).toHaveLength(0);
  });

  it('drops malformed responses (missing requestId / unknown behavior)', async () => {
    const win = makeWindow();
    const promise = requestPermission(makeRequest({ requestId: 'r_x' }), {
      window: win as unknown as Parameters<typeof requestPermission>[1]['window'],
      timeoutMs: 50,
    });
    vi.useFakeTimers();
    deliverResponse({ requestId: '', behavior: 'allow' } as PermissionDecision);
    deliverResponse({
      requestId: 'r_x',
      behavior: 'maybe' as unknown as 'allow',
    });
    expect(pendingPermissionCountForTest()).toBe(1);
    vi.advanceTimersByTime(51);
    const decision = await promise;
    expect(decision.behavior).toBe('deny');
    vi.useRealTimers();
  });
});
