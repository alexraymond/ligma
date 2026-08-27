import type { DesignPin, DesignSnapshotSummary } from '@ligma/api';
/**
 * The Studio's pure state: shape gating, pin staging, version-rail selection
 * and the advisory tweak-control fallback. All DOM-free, which is what lets the
 * app's node-environment vitest cover them.
 */
import { describe, expect, it } from 'vitest';
import {
  EXPORT_FORMATS,
  comparePair,
  controlFor,
  filenameFromDisposition,
  pinAppliedIn,
  stagedPins,
  studioVisible,
  toggleCompare,
  versionDiff,
  versionTimeLabel,
} from './api';

function pin(overrides: Partial<DesignPin> = {}): DesignPin {
  return {
    id: 'pin_1',
    filePath: 'index.html',
    selector: '#hero',
    tag: 'div',
    outerHTML: "<div id='hero'></div>",
    parentOuterHTML: null,
    text: 'make it warmer',
    scope: 'element',
    status: 'pending',
    createdAt: '2026-08-11T00:00:00.000Z',
    appliedInVersionId: null,
    ...overrides,
  };
}

function snapshot(n: number, versionId = `v${n}`): DesignSnapshotSummary {
  return {
    versionId,
    n,
    createdAt: '2026-08-11T00:00:00.000Z',
    origin: 'prompt',
    label: `turn ${n}`,
    fileCount: 2,
    totalBytes: 2048,
    restoredFrom: null,
  };
}

describe('studioVisible — shape gating', () => {
  it('renders for the shapes that have a design stage', () => {
    expect(studioVisible('ui')).toBe(true);
    expect(studioVisible('mixed')).toBe(true);
  });

  it('is absent for headless projects — never a stubbed empty tab', () => {
    expect(studioVisible('headless')).toBe(false);
  });

  it('is absent until the shape is confirmed', () => {
    expect(studioVisible(undefined)).toBe(false);
  });
});

describe('stagedPins', () => {
  it('stages only pending pins — applied ones are history', () => {
    const pins = [pin({ id: 'a' }), pin({ id: 'b', status: 'applied', appliedInVersionId: 'v2' })];
    expect(stagedPins(pins).map((p) => p.id)).toEqual(['a']);
  });

  it('returns an empty list when nothing is staged', () => {
    expect(stagedPins([pin({ status: 'applied' })])).toEqual([]);
  });
});

describe('pinAppliedIn — each applied pin links to the turn that applied it', () => {
  const snapshots = [snapshot(1), snapshot(2)];

  it('resolves the version that applied the pin', () => {
    expect(pinAppliedIn(pin({ status: 'applied', appliedInVersionId: 'v2' }), snapshots)?.n).toBe(
      2,
    );
  });

  it('is null for a staged pin', () => {
    expect(pinAppliedIn(pin(), snapshots)).toBeNull();
  });

  it('is null when the version is no longer on the rail', () => {
    expect(
      pinAppliedIn(pin({ status: 'applied', appliedInVersionId: 'gone' }), snapshots),
    ).toBeNull();
  });
});

describe('toggleCompare — version-rail selection', () => {
  it('collects up to two versions', () => {
    expect(toggleCompare([], 'v1')).toEqual(['v1']);
    expect(toggleCompare(['v1'], 'v2')).toEqual(['v1', 'v2']);
  });

  it('deselects an already-picked version', () => {
    expect(toggleCompare(['v1', 'v2'], 'v1')).toEqual(['v2']);
  });

  it('drops the oldest half on a third pick', () => {
    expect(toggleCompare(['v1', 'v2'], 'v3')).toEqual(['v2', 'v3']);
  });
});

describe('comparePair', () => {
  const snapshots = [snapshot(1), snapshot(2), snapshot(3)];

  it('orders before/after by version number, whichever order was clicked', () => {
    expect(comparePair(['v3', 'v1'], snapshots)).toEqual({
      before: snapshot(1),
      after: snapshot(3),
    });
  });

  it('needs exactly two known versions', () => {
    expect(comparePair(['v1'], snapshots)).toBeNull();
    expect(comparePair(['v1', 'gone'], snapshots)).toBeNull();
    expect(comparePair([], snapshots)).toBeNull();
  });
});

describe('controlFor — the tweak schema is advisory', () => {
  it("uses the agent's declaration when there is one", () => {
    const declared = { kind: 'enum' as const, options: ['a', 'b'], live: true };
    expect(controlFor(declared, 'a')).toBe(declared);
  });

  it('infers a control from the value shape for an undeclared token', () => {
    expect(controlFor(undefined, true).kind).toBe('boolean');
    expect(controlFor(undefined, 12).kind).toBe('number');
    expect(controlFor(undefined, '#ff8800').kind).toBe('color');
    expect(controlFor(undefined, 'Inter, sans-serif').kind).toBe('string');
  });
});

describe('versionDiff — content-addressed before/after', () => {
  it('classifies added, removed, changed and unchanged by fingerprint', () => {
    const before = [
      { path: 'home.html', fingerprint: 'aaa' },
      { path: 'about.html', fingerprint: 'bbb' },
      { path: 'gone.html', fingerprint: 'ccc' },
    ];
    const after = [
      { path: 'home.html', fingerprint: 'aaa' },
      { path: 'about.html', fingerprint: 'zzz' },
      { path: 'new.html', fingerprint: 'ddd' },
    ];
    expect(versionDiff(before, after)).toEqual([
      { path: 'new.html', change: 'added' },
      { path: 'gone.html', change: 'removed' },
      { path: 'about.html', change: 'changed' },
      { path: 'home.html', change: 'unchanged' },
    ]);
  });

  it('reports identical versions as entirely unchanged', () => {
    const files = [{ path: 'a.html', fingerprint: 'x' }];
    expect(versionDiff(files, files).every((c) => c.change === 'unchanged')).toBe(true);
  });
});

// F6: a rail is memory and memory needs "when" — createdAt existed on
// DesignSnapshotSummary but was never rendered.
describe('versionTimeLabel', () => {
  const NOW = new Date('2026-08-12T12:00:00.000Z').getTime();

  it('gives a relative label for a recent snapshot', () => {
    const iso = new Date(NOW - 3 * 3_600_000).toISOString();
    expect(versionTimeLabel(iso, NOW).relative).toBe('3h ago');
  });

  it('carries the absolute date+time for the hover title', () => {
    expect(versionTimeLabel('2026-08-01T14:30:00.000Z', NOW).absolute).toMatch(/^Aug 1, /);
  });
});

// D7 DC-1: the download keeps the name the daemon gave it, so five exports of
// the same design do not all land as "design.zip".
describe('filenameFromDisposition', () => {
  it("reads the daemon's filename", () => {
    expect(filenameFromDisposition('attachment; filename="checkout-flow-v3.zip"')).toBe(
      'checkout-flow-v3.zip',
    );
  });

  it('returns null rather than a guess when the header is absent or odd', () => {
    expect(filenameFromDisposition(null)).toBeNull();
    expect(filenameFromDisposition('attachment')).toBeNull();
  });

  it('offers every format the exporters package ships', () => {
    expect(EXPORT_FORMATS.map((f) => f.format)).toEqual([
      'zip',
      'html',
      'pdf',
      'pptx',
      'markdown',
      'png',
      'jpeg',
      'webp',
    ]);
  });
});
