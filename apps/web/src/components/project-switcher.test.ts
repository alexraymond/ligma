import type { Project } from '@ligma/api';
/**
 * Pure logic behind the project switcher (top-bar Linear/Notion-style
 * dropdown): which project the current route is "in", and how the dropdown
 * filters/orders the list. Rendering needs Radix's Popover portal, so — same
 * split as board-view.test.ts — only the branchy, DOM-free parts are tested
 * here (vitest.config.ts runs in the "node" environment).
 */
import { describe, expect, it } from 'vitest';
import { currentProjectIdFromPathname, filterAndSortProjects } from './project-switcher';

function project(id: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    name: id,
    description: '',
    status: 'active',
    color: '#6366f1',
    teamMembers: [],
    createdAt: '2026-01-01T00:00:00Z',
    tags: [],
    deletedAt: null,
    ...overrides,
  };
}

describe('currentProjectIdFromPathname', () => {
  it('extracts the id from a project route', () => {
    expect(currentProjectIdFromPathname('/projects/proj_123')).toBe('proj_123');
  });

  it('extracts the id from a nested project route', () => {
    expect(currentProjectIdFromPathname('/projects/proj_123/board')).toBe('proj_123');
  });

  it('decodes a URI-encoded id', () => {
    expect(currentProjectIdFromPathname('/projects/proj%20123')).toBe('proj 123');
  });

  it('returns null outside a project route', () => {
    expect(currentProjectIdFromPathname('/projects')).toBeNull();
    expect(currentProjectIdFromPathname('/')).toBeNull();
    expect(currentProjectIdFromPathname('/board')).toBeNull();
  });
});

describe('filterAndSortProjects', () => {
  it('excludes archived projects', () => {
    const active = project('a', { status: 'active' });
    const archived = project('b', { status: 'archived' });
    expect(filterAndSortProjects([active, archived], '').map((p) => p.id)).toEqual(['a']);
  });

  it('puts active projects before paused/completed ones', () => {
    const paused = project('a', { status: 'paused' });
    const active = project('b', { status: 'active' });
    const completed = project('c', { status: 'completed' });
    expect(filterAndSortProjects([paused, active, completed], '').map((p) => p.id)).toEqual([
      'b',
      'a',
      'c',
    ]);
  });

  it('preserves relative order within the same status (no updatedAt to rank by)', () => {
    const a = project('a', { status: 'active' });
    const b = project('b', { status: 'active' });
    const c = project('c', { status: 'active' });
    expect(filterAndSortProjects([a, b, c], '').map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('filters by name, case-insensitively', () => {
    const apollo = project('a', { name: 'Apollo' });
    const zeus = project('b', { name: 'Zeus' });
    expect(filterAndSortProjects([apollo, zeus], 'apo').map((p) => p.id)).toEqual(['a']);
    expect(filterAndSortProjects([apollo, zeus], 'APOLLO').map((p) => p.id)).toEqual(['a']);
  });

  it('does not mutate the input array', () => {
    const paused = project('a', { status: 'paused' });
    const active = project('b', { status: 'active' });
    const input = [paused, active];
    filterAndSortProjects(input, '');
    expect(input.map((p) => p.id)).toEqual(['a', 'b']);
  });
});
