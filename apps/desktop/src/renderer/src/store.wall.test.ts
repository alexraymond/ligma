import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCodesignStore } from './store';

const initialState = useCodesignStore.getState();

beforeEach(() => {
  // Cherry-pick the wall-relevant slices back to defaults so each test starts
  // from a known empty state. Keep other store fields intact so any actions
  // we exercise that touch (e.g.) toasts won't blow up on a missing slice.
  useCodesignStore.setState({
    ...initialState,
    previewHtmlByFile: {},
    fileListByDesign: {},
    wallSelectedPaths: [],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('toggleWallSelection', () => {
  it('adds a path on first toggle and removes it on second', () => {
    const { toggleWallSelection } = useCodesignStore.getState();
    toggleWallSelection('dashboard.html');
    expect(useCodesignStore.getState().wallSelectedPaths).toEqual(['dashboard.html']);
    toggleWallSelection('dashboard.html');
    expect(useCodesignStore.getState().wallSelectedPaths).toEqual([]);
  });

  it('preserves order when adding multiple paths', () => {
    const { toggleWallSelection } = useCodesignStore.getState();
    toggleWallSelection('a.html');
    toggleWallSelection('b.html');
    toggleWallSelection('c.html');
    expect(useCodesignStore.getState().wallSelectedPaths).toEqual(['a.html', 'b.html', 'c.html']);
  });
});

describe('clearWallSelection', () => {
  it('drains the selection list', () => {
    useCodesignStore.setState({ wallSelectedPaths: ['a.html', 'b.html'] });
    useCodesignStore.getState().clearWallSelection();
    expect(useCodesignStore.getState().wallSelectedPaths).toEqual([]);
  });

  it('is a no-op when already empty (no spurious set call)', () => {
    // Capture state object identity — if clearWallSelection short-circuits on
    // empty, the object reference shouldn't change.
    const before = useCodesignStore.getState();
    useCodesignStore.getState().clearWallSelection();
    expect(useCodesignStore.getState()).toBe(before);
  });
});

describe('recordAgentFileUpdate', () => {
  it('writes content into previewHtmlByFile under the {designId}::{path} key', () => {
    vi.stubGlobal('window', {
      codesign: {
        files: { upsert: vi.fn().mockResolvedValue({}) },
      },
    });
    useCodesignStore.getState().recordAgentFileUpdate({
      designId: 'design-1',
      path: 'dashboard.html',
      content: '<html>dash</html>',
    });
    const state = useCodesignStore.getState();
    expect(state.previewHtmlByFile['design-1::dashboard.html']).toBe('<html>dash</html>');
  });

  it('appends new paths to fileListByDesign without dedupe-removing existing ones', () => {
    vi.stubGlobal('window', {
      codesign: {
        files: { upsert: vi.fn().mockResolvedValue({}) },
      },
    });
    const { recordAgentFileUpdate } = useCodesignStore.getState();
    recordAgentFileUpdate({ designId: 'd1', path: 'a.html', content: '<a/>' });
    recordAgentFileUpdate({ designId: 'd1', path: 'b.html', content: '<b/>' });
    expect(useCodesignStore.getState().fileListByDesign['d1']).toEqual(['a.html', 'b.html']);
  });

  it('does not duplicate a path on repeated writes (idempotent file list)', () => {
    vi.stubGlobal('window', {
      codesign: {
        files: { upsert: vi.fn().mockResolvedValue({}) },
      },
    });
    const { recordAgentFileUpdate } = useCodesignStore.getState();
    recordAgentFileUpdate({ designId: 'd1', path: 'a.html', content: 'v1' });
    recordAgentFileUpdate({ designId: 'd1', path: 'a.html', content: 'v2' });
    expect(useCodesignStore.getState().fileListByDesign['d1']).toEqual(['a.html']);
    expect(useCodesignStore.getState().previewHtmlByFile['d1::a.html']).toBe('v2');
  });

  it('persists via files.upsert IPC for every write', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    vi.stubGlobal('window', {
      codesign: { files: { upsert } },
    });
    useCodesignStore.getState().recordAgentFileUpdate({
      designId: 'd1',
      path: 'a.html',
      content: '<a/>',
    });
    // Fire-and-forget — settle the microtask so the .catch doesn't dangle.
    await Promise.resolve();
    expect(upsert).toHaveBeenCalledWith('d1', 'a.html', '<a/>');
  });

  it('survives a missing window.codesign.files binding', () => {
    vi.stubGlobal('window', { codesign: {} });
    expect(() =>
      useCodesignStore.getState().recordAgentFileUpdate({
        designId: 'd1',
        path: 'a.html',
        content: '<a/>',
      }),
    ).not.toThrow();
    expect(useCodesignStore.getState().previewHtmlByFile['d1::a.html']).toBe('<a/>');
  });
});

describe('reorderWallCards', () => {
  beforeEach(() => {
    useCodesignStore.setState({
      ...initialState,
      previewHtmlByFile: {},
      fileListByDesign: { d1: ['index.html', 'dashboard.html', 'settings.html', 'signup.html'] },
      wallSelectedPaths: [],
    });
  });

  it('moves a later card before an earlier one', () => {
    useCodesignStore.getState().reorderWallCards('d1', 'signup.html', 'dashboard.html');
    expect(useCodesignStore.getState().fileListByDesign['d1']).toEqual([
      'index.html',
      'signup.html',
      'dashboard.html',
      'settings.html',
    ]);
  });

  it('moves an earlier card after a later one (adjusts insertion index post-splice)', () => {
    useCodesignStore.getState().reorderWallCards('d1', 'index.html', 'signup.html');
    // Drop "before signup.html" — after splice removes index, signup is at
    // index 2; we insert at adjusted index 2, landing index right before it.
    expect(useCodesignStore.getState().fileListByDesign['d1']).toEqual([
      'dashboard.html',
      'settings.html',
      'index.html',
      'signup.html',
    ]);
  });

  it('is a no-op when from === to', () => {
    const before = useCodesignStore.getState().fileListByDesign['d1'];
    useCodesignStore.getState().reorderWallCards('d1', 'index.html', 'index.html');
    expect(useCodesignStore.getState().fileListByDesign['d1']).toBe(before);
  });

  it('is a no-op when paths are missing from the list', () => {
    const before = useCodesignStore.getState().fileListByDesign['d1'];
    useCodesignStore.getState().reorderWallCards('d1', 'ghost.html', 'index.html');
    expect(useCodesignStore.getState().fileListByDesign['d1']).toBe(before);
  });

  it('is a no-op when designId is unknown', () => {
    useCodesignStore.getState().reorderWallCards('unknown', 'a', 'b');
    expect(useCodesignStore.getState().fileListByDesign['d1']).toEqual([
      'index.html',
      'dashboard.html',
      'settings.html',
      'signup.html',
    ]);
  });
});

describe('hydrateFilesForDesign', () => {
  it('loads every HTML file via files.list + files.read into the cache', async () => {
    const list = vi.fn().mockResolvedValue([
      { path: 'index.html' },
      { path: 'dashboard.html' },
      { path: 'turn-01.html' }, // archive — should be filtered out
      { path: 'README.md' }, // non-HTML — should be filtered out
    ]);
    const read = vi.fn(async (_designId: string, path: string) => ({
      content: `<html>${path}</html>`,
    }));
    vi.stubGlobal('window', {
      codesign: { files: { list, read } },
    });

    await useCodesignStore.getState().hydrateFilesForDesign('d1');

    const state = useCodesignStore.getState();
    expect(state.fileListByDesign['d1']).toEqual(['index.html', 'dashboard.html']);
    expect(state.previewHtmlByFile['d1::index.html']).toBe('<html>index.html</html>');
    expect(state.previewHtmlByFile['d1::dashboard.html']).toBe('<html>dashboard.html</html>');
    expect(state.previewHtmlByFile['d1::turn-01.html']).toBeUndefined();
  });

  it('is a no-op when window.codesign.files is missing', async () => {
    vi.stubGlobal('window', { codesign: {} });
    await expect(useCodesignStore.getState().hydrateFilesForDesign('d1')).resolves.toBeUndefined();
    expect(useCodesignStore.getState().fileListByDesign['d1']).toBeUndefined();
  });

  it('skips files whose read returns null without aborting the whole load', async () => {
    const list = vi.fn().mockResolvedValue([{ path: 'a.html' }, { path: 'b.html' }]);
    const read = vi.fn(async (_designId: string, path: string) =>
      path === 'a.html' ? { content: '<a/>' } : null,
    );
    vi.stubGlobal('window', {
      codesign: { files: { list, read } },
    });
    await useCodesignStore.getState().hydrateFilesForDesign('d1');
    const state = useCodesignStore.getState();
    expect(state.fileListByDesign['d1']).toEqual(['a.html']);
    expect(state.previewHtmlByFile['d1::a.html']).toBe('<a/>');
    expect(state.previewHtmlByFile['d1::b.html']).toBeUndefined();
  });
});
