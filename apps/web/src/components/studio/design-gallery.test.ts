import type { DesignSummary } from '@ligma/api';
/**
 * The switcher's one piece of logic: the line under each design's title. It is
 * the reason the bare `<select>` went away, so it is the part worth pinning.
 */
import { describe, expect, it } from 'vitest';
import { designMeta } from './design-gallery';

const NOW = Date.parse('2026-08-26T12:00:00.000Z');

function summary(overrides: Partial<DesignSummary> = {}): DesignSummary {
  return {
    id: 'dsn_1',
    projectId: 'proj_1',
    title: 'Billing',
    status: 'drafting',
    createdAt: '2026-08-26T10:00:00.000Z',
    updatedAt: '2026-08-26T11:00:00.000Z',
    designSystem: null,
    versionCount: 2,
    files: [
      { path: 'a.html', fingerprint: 'f1', byteSize: 10 },
      { path: 'b.html', fingerprint: 'f2', byteSize: 20 },
    ],
    critiqueScore: null,
    pendingPinCount: 0,
    ...overrides,
  };
}

describe('designMeta', () => {
  it('counts the screens in the newest version and says when it last moved', () => {
    expect(designMeta(summary(), NOW)).toBe('2 screens · 1h ago');
  });

  it('keeps the count singular for one screen', () => {
    expect(
      designMeta(summary({ files: [{ path: 'a.html', fingerprint: 'f1', byteSize: 10 }] }), NOW),
    ).toBe('1 screen · 1h ago');
  });

  it("says a design with no version has none, rather than '0 screens'", () => {
    expect(designMeta(summary({ versionCount: 0, files: [] }), NOW)).toBe(
      'No versions yet · 1h ago',
    );
  });
});
