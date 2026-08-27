import { beforeEach, describe, expect, it, vi } from 'vitest';

const probeAllBackendsMock = vi.fn();
vi.mock('../../engine/backend-probe', () => ({
  probeAllBackends: (force?: boolean) => probeAllBackendsMock(force),
}));

beforeEach(() => {
  probeAllBackendsMock.mockReset();
});

describe('GET /api/backends', () => {
  it('returns the probe list without forcing a rescan', async () => {
    probeAllBackendsMock.mockResolvedValue([{ backend: 'claude', available: true }]);
    const { GET } = await import('./route');

    const res = await GET(new Request('http://localhost/api/backends') as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ backends: [{ backend: 'claude', available: true }] });
    expect(probeAllBackendsMock).toHaveBeenCalledWith(undefined);
  });
});
