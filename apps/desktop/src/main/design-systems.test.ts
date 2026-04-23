/**
 * Unit tests for the design_systems table + linkage to designs.
 *
 * Runs against an in-memory SQLite — no filesystem, no Electron.
 */

import { describe, expect, it } from 'vitest';
import {
  createDesign,
  createDesignSystem,
  deleteDesignSystem,
  getDesign,
  getDesignSystem,
  initInMemoryDb,
  linkDesignSystemToDesign,
  listDesignSystems,
  renameDesignSystem,
} from './snapshots-db';

function seedDs(db = initInMemoryDb()) {
  return createDesignSystem(db, {
    name: 'Project Indigo',
    rootPath: '/repos/indigo',
    summary: 'Scanned 12 tokens. Color language: oklch(...)...',
    extractedAt: '2026-04-23T00:00:00.000Z',
    sourceFiles: ['tailwind.config.ts', 'theme.css'],
    colors: ['oklch(62% 0.22 265)', '#f8f5f0'],
    fonts: ['Fraunces', 'Geist'],
    spacing: ['0.25rem', '0.5rem'],
    radius: ['0.5rem'],
    shadows: ['0 1px 2px rgba(0,0,0,0.04)'],
  });
}

describe('design_systems table', () => {
  it('creates a row and lists it', () => {
    const db = initInMemoryDb();
    const row = seedDs(db);
    expect(row.id).toBeTruthy();
    expect(row.name).toBe('Project Indigo');
    expect(row.colors).toEqual(['oklch(62% 0.22 265)', '#f8f5f0']);
    expect(listDesignSystems(db)).toHaveLength(1);
  });

  it('renameDesignSystem updates name and touches updated_at', () => {
    const db = initInMemoryDb();
    const row = seedDs(db);
    const originalUpdatedAt = row.updatedAt;
    // Busy-wait enough for the ISO string to tick forward reliably.
    const until = Date.now() + 5;
    while (Date.now() < until) {
      /* spin */
    }
    const renamed = renameDesignSystem(db, row.id, 'Indigo');
    expect(renamed.name).toBe('Indigo');
    expect(renamed.updatedAt).not.toBe(originalUpdatedAt);
  });

  it('deleteDesignSystem nulls linked designs via ON DELETE SET NULL', () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Landing');
    const ds = seedDs(db);
    linkDesignSystemToDesign(db, design.id, ds.id);
    expect(getDesign(db, design.id)?.designSystemId).toBe(ds.id);

    deleteDesignSystem(db, ds.id);
    expect(getDesignSystem(db, ds.id)).toBeNull();
    expect(getDesign(db, design.id)?.designSystemId).toBeNull();
  });

  it('linkDesignSystemToDesign accepts null to unbind', () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Landing');
    const ds = seedDs(db);
    linkDesignSystemToDesign(db, design.id, ds.id);
    expect(getDesign(db, design.id)?.designSystemId).toBe(ds.id);
    linkDesignSystemToDesign(db, design.id, null);
    expect(getDesign(db, design.id)?.designSystemId).toBeNull();
  });
});
