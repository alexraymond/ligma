import { describe, expect, it } from 'vitest';
import { findSystemChrome } from './chrome-discovery';

const macPath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const winPath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const linuxPath = '/usr/bin/google-chrome';

describe('findSystemChrome', () => {
  it('finds Chrome on macOS at the canonical path', async () => {
    const found = await findSystemChrome({
      platform: 'darwin',
      env: {},
      fileExists: (p) => p === macPath,
      which: () => null,
    });
    expect(found).toBe(macPath);
  });

  it('finds Chrome on Windows under ProgramFiles', async () => {
    const found = await findSystemChrome({
      platform: 'win32',
      env: { ProgramFiles: 'C:\\Program Files' },
      fileExists: (p) => p === winPath,
      which: () => null,
    });
    expect(found).toBe(winPath);
  });

  it('finds Chrome on Linux via which()', async () => {
    const found = await findSystemChrome({
      platform: 'linux',
      env: {},
      fileExists: (p) => p === linuxPath,
      which: (bin) => (bin === 'google-chrome-stable' ? linuxPath : null),
    });
    expect(found).toBe(linuxPath);
  });

  it('prefers LIGMA_CHROME_PATH override when set', async () => {
    const custom = '/opt/brave/brave';
    const found = await findSystemChrome({
      platform: 'darwin',
      env: { LIGMA_CHROME_PATH: custom },
      fileExists: (p) => p === custom,
      which: () => null,
    });
    expect(found).toBe(custom);
  });

  it('falls back to the legacy CODESIGN_CHROME_PATH override when set', async () => {
    const custom = '/opt/brave/brave';
    const found = await findSystemChrome({
      platform: 'darwin',
      env: { CODESIGN_CHROME_PATH: custom },
      fileExists: (p) => p === custom,
      which: () => null,
    });
    expect(found).toBe(custom);
  });

  it('prefers LIGMA_CHROME_PATH over the legacy CODESIGN_CHROME_PATH when both are set', async () => {
    const current = '/opt/current/chrome';
    const legacy = '/opt/legacy/chrome';
    const found = await findSystemChrome({
      platform: 'darwin',
      env: { LIGMA_CHROME_PATH: current, CODESIGN_CHROME_PATH: legacy },
      fileExists: (p) => p === current || p === legacy,
      which: () => null,
    });
    expect(found).toBe(current);
  });

  it('throws EXPORTER_NO_CHROME with install link when nothing is found', async () => {
    await expect(
      findSystemChrome({
        platform: 'darwin',
        env: {},
        fileExists: () => false,
        which: () => null,
      }),
    ).rejects.toMatchObject({
      code: 'EXPORTER_NO_CHROME',
      message: expect.stringContaining('https://www.google.com/chrome'),
    });
  });

  it('throws on Linux when no candidate binary resolves', async () => {
    await expect(
      findSystemChrome({
        platform: 'linux',
        env: {},
        fileExists: () => false,
        which: () => null,
      }),
    ).rejects.toMatchObject({ code: 'EXPORTER_NO_CHROME' });
  });
});
