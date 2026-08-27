import { beforeEach, describe, expect, it, vi } from 'vitest';

// execFile is mocked at the node:child_process boundary — no real CLI runs.
// A plain callback mock is enough because backend-probe.ts reads the
// callback's stdout arg directly rather than relying on
// util.promisify(execFile)'s Node-only `{ stdout, stderr }` custom shape.
const execFileMock = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => (execFileMock as (...a: unknown[]) => void)(...args),
}));

const probeBackendMock = vi.fn();
vi.mock('./runner', () => ({
  AgentRunner: { probeBackend: (backend: string) => probeBackendMock(backend) },
}));

const loadConfigMock = vi.fn();
vi.mock('./config', () => ({ loadConfig: () => loadConfigMock() }));

type Cb = (err: Error | null, stdout: string) => void;

/** Queue one resolved stdout (or a rejection) for the next `execFile` call, in call order. */
function nextExec(result: { stdout: string } | { error: Error }) {
  execFileMock.mockImplementationOnce((_bin: string, _args: string[], _opts: unknown, cb: Cb) => {
    if ('error' in result) cb(result.error, '');
    else cb(null, result.stdout);
  });
}

/** claude/codex/gemini all resolved and available, at trivial made-up paths. */
function resolveAllAvailable() {
  probeBackendMock.mockImplementation((backend: string) => ({
    backend,
    available: true,
    path: `/bin/${backend}`,
  }));
}

/** The 4 execFile calls a full probeAllBackends() makes when all 3 resolve available:
 *  claude --version, claude auth status, codex --version, gemini --version
 *  (codex/gemini auth is a no-spawn short-circuit — see module doc). */
function queueHappyPathExecs(opts: { claudeVersion?: string; loggedIn?: boolean } = {}) {
  nextExec({ stdout: opts.claudeVersion ?? '2.1.229 (Claude Code)' });
  nextExec({ stdout: JSON.stringify({ loggedIn: opts.loggedIn ?? true }) });
  nextExec({ stdout: '0.5.0' }); // codex --version
  nextExec({ stdout: '0.30.0' }); // gemini --version
}

beforeEach(() => {
  vi.resetModules();
  execFileMock.mockReset();
  probeBackendMock.mockReset();
  loadConfigMock.mockReset();
  loadConfigMock.mockReturnValue({
    execution: { claudeBinaryPath: null, codexBinaryPath: null, geminiBinaryPath: null },
  });
});

const load = () => import('./backend-probe');

describe('probeAllBackends', () => {
  it('reports available:false with causeKind env when resolution fails, and never spawns a CLI', async () => {
    probeBackendMock.mockImplementation((backend: string) => ({
      backend,
      available: false,
      path: backend,
      message: `${backend} binary not found`,
    }));

    const { probeAllBackends } = await load();
    const backends = await probeAllBackends();

    expect(backends).toHaveLength(3);
    for (const b of backends) {
      expect(b.available).toBe(false);
      expect(b.causeKind).toBe('env');
      expect(b.version).toBeNull();
      expect(b.authStatus).toBe('unknown');
      expect(b.message).toBe(`${b.backend} binary not found`);
    }
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('claude: parses --version and a loggedIn:true auth status into authenticated/no causeKind', async () => {
    resolveAllAvailable();
    queueHappyPathExecs({ claudeVersion: '2.1.229 (Claude Code)', loggedIn: true });

    const { probeAllBackends } = await load();
    const claude = (await probeAllBackends()).find((b) => b.backend === 'claude')!;

    expect(claude.available).toBe(true);
    expect(claude.version).toBe('2.1.229 (Claude Code)');
    expect(claude.authStatus).toBe('authenticated');
    expect(claude.causeKind).toBeNull();
  });

  it('claude: loggedIn:false auth status maps to unauthenticated + causeKind auth', async () => {
    resolveAllAvailable();
    queueHappyPathExecs({ loggedIn: false });

    const { probeAllBackends } = await load();
    const claude = (await probeAllBackends()).find((b) => b.backend === 'claude')!;

    expect(claude.authStatus).toBe('unauthenticated');
    expect(claude.causeKind).toBe('auth');
  });

  it('codex and gemini: available but auth status is honestly unknown (no cheap check exists, no spawn attempted)', async () => {
    resolveAllAvailable();
    queueHappyPathExecs();

    const { probeAllBackends } = await load();
    const backends = await probeAllBackends();
    const codex = backends.find((b) => b.backend === 'codex')!;
    const gemini = backends.find((b) => b.backend === 'gemini')!;

    expect(codex.version).toBe('0.5.0');
    expect(codex.authStatus).toBe('unknown');
    expect(codex.causeKind).toBeNull();
    expect(gemini.version).toBe('0.30.0');
    expect(gemini.authStatus).toBe('unknown');
    expect(gemini.causeKind).toBeNull();
    // 4, not 6: no auth-status spawn for codex/gemini.
    expect(execFileMock).toHaveBeenCalledTimes(4);
  });

  it('a --version spawn failure degrades to version:null rather than throwing', async () => {
    resolveAllAvailable();
    nextExec({ error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) });
    nextExec({ stdout: JSON.stringify({ loggedIn: true }) });
    nextExec({ stdout: '0.5.0' });
    nextExec({ stdout: '0.30.0' });

    const { probeAllBackends } = await load();
    const claude = (await probeAllBackends()).find((b) => b.backend === 'claude')!;
    expect(claude.version).toBeNull();
    expect(claude.authStatus).toBe('authenticated');
  });

  it('caches per backend until a forced rescan', async () => {
    resolveAllAvailable();
    queueHappyPathExecs({ claudeVersion: '1.0.0' });

    const { probeAllBackends } = await load();
    await probeAllBackends();
    await probeAllBackends(); // cached — no new resolution, no new execFile calls
    expect(probeBackendMock).toHaveBeenCalledTimes(3); // once per backend, ever
    expect(execFileMock).toHaveBeenCalledTimes(4);

    queueHappyPathExecs({ claudeVersion: '2.0.0' });
    const claude = (await probeAllBackends(true)).find((b) => b.backend === 'claude')!;
    expect(claude.version).toBe('2.0.0');
    expect(probeBackendMock).toHaveBeenCalledTimes(6);
  });

  it('configuredPath reflects the daemon config override for the matching backend only', async () => {
    loadConfigMock.mockReturnValue({
      execution: {
        claudeBinaryPath: '/custom/claude',
        codexBinaryPath: null,
        geminiBinaryPath: null,
      },
    });
    resolveAllAvailable();
    queueHappyPathExecs();

    const { probeAllBackends } = await load();
    const backends = await probeAllBackends();
    expect(backends.find((b) => b.backend === 'claude')!.configuredPath).toBe('/custom/claude');
    expect(backends.find((b) => b.backend === 'codex')!.configuredPath).toBeNull();
  });
});
