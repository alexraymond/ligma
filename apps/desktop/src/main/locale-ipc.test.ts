import { describe, expect, it, vi } from 'vitest';

vi.mock('./electron-runtime', () => ({
  app: { getLocale: () => 'en-US' },
  ipcMain: { handle: vi.fn() },
}));

const writeFileMock = vi.fn<(path: string, data: string, encoding: string) => Promise<void>>(
  async () => {},
);
const mkdirMock = vi.fn<(path: string, opts: { recursive?: boolean }) => Promise<void>>(
  async () => {},
);

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: (path: string, data: string, encoding: string) => writeFileMock(path, data, encoding),
  mkdir: (path: string, opts: { recursive?: boolean }) => mkdirMock(path, opts),
}));

import { ipcMain } from './electron-runtime';
import { registerLocaleIpc } from './locale-ipc';

function getSetHandler(): (...args: unknown[]) => unknown {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const handleMock = ipcMain.handle as unknown as ReturnType<typeof vi.fn>;
  handleMock.mockImplementation((channel: unknown, fn: unknown) => {
    handlers.set(channel as string, fn as (...args: unknown[]) => unknown);
  });
  registerLocaleIpc();
  const fn = handlers.get('locale:set');
  if (!fn) throw new Error('locale:set not registered');
  return fn;
}

describe('locale-ipc XDG_CONFIG_HOME', () => {
  it('writes locale.json under XDG_CONFIG_HOME when set', async () => {
    const prev = process.env['XDG_CONFIG_HOME'];
    process.env['XDG_CONFIG_HOME'] = '/tmp/xdg-locale-test';
    try {
      writeFileMock.mockClear();
      const set = getSetHandler();
      await set({}, 'en');
      expect(writeFileMock).toHaveBeenCalled();
      const firstCall = writeFileMock.mock.calls[0];
      expect(firstCall?.[0]).toBe('/tmp/xdg-locale-test/ligma/locale.json');
    } finally {
      if (prev === undefined) process.env['XDG_CONFIG_HOME'] = undefined;
      else process.env['XDG_CONFIG_HOME'] = prev;
    }
  });
});

describe('locale-ipc input validation', () => {
  it('coerces any input to the single supported locale', async () => {
    writeFileMock.mockClear();
    const set = getSetHandler();
    const result = await set({}, 'fr-FR');
    expect(result).toBe('en');
    const firstCall = writeFileMock.mock.calls.at(-1);
    const persisted = JSON.parse(String(firstCall?.[1] ?? '{}'));
    expect(persisted.locale).toBe('en');
    expect(persisted.schemaVersion).toBe(1);
  });

  it('rejects empty / non-string input', async () => {
    const set = getSetHandler();
    await expect(set({}, '')).rejects.toThrow();
    await expect(set({}, 123)).rejects.toThrow();
    await expect(set({}, null)).rejects.toThrow();
  });
});
