import { beforeEach, describe, expect, it, vi } from 'vitest';

const probeAllBackendsMock = vi.fn();
const clearBinaryCacheMock = vi.fn();
vi.mock('../../../engine/backend-probe', () => ({
  probeAllBackends: (force?: boolean) => probeAllBackendsMock(force),
}));
vi.mock('../../../engine/runner', () => ({ clearBinaryCache: () => clearBinaryCacheMock() }));

beforeEach(() => {
  probeAllBackendsMock.mockReset();
  clearBinaryCacheMock.mockReset();
});

describe('POST /api/backends/rescan', () => {
  it('forces a fresh probe (cache-busting) and returns the result', async () => {
    probeAllBackendsMock.mockResolvedValue([{ backend: 'codex', available: false }]);
    const { POST } = await import('./route');

    const res = await POST();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ backends: [{ backend: 'codex', available: false }] });
    expect(probeAllBackendsMock).toHaveBeenCalledWith(true);
  });

  it('clears the resolved-binary cache too, and does it before re-probing (P10)', async () => {
    probeAllBackendsMock.mockResolvedValue([]);
    const { POST } = await import('./route');

    await POST();

    // Clearing only the probe cache left every spawn on the old binary while
    // Settings said "saved" and this route said "available".
    expect(clearBinaryCacheMock).toHaveBeenCalledTimes(1);
    expect(clearBinaryCacheMock.mock.invocationCallOrder[0]).toBeLessThan(
      probeAllBackendsMock.mock.invocationCallOrder[0]!,
    );
  });
});
