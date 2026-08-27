/**
 * The `?` sheet must list exactly what is wired — the invariant
 * keyboard-shortcuts.tsx's own comment names ("the same map drives both the
 * handler and the help dialog"). This proves it structurally instead of by
 * reading: one array literal, both consumers derived from it, and every chord
 * pointing at a route the IA still owns.
 *
 * fs rather than a render: this vitest config runs node-only (same spirit as
 * governor-card.test.ts and the other wiring proofs in this repo).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { railKeyFor } from '@/lib/nav';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(
  path.resolve(__dirname, '../src/components/keyboard-shortcuts.tsx'),
  'utf-8',
);

/** The chord table, read out of the one array literal that defines it. */
function chords(): { key: string; href: string }[] {
  const start = SOURCE.indexOf('const shortcuts:');
  const end = SOURCE.indexOf('];', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return [...SOURCE.slice(start, end).matchAll(/key: '([^']+)'.*?href: '([^']+)'/g)].map((m) => ({
    key: m[1],
    href: m[2],
  }));
}

describe('the ? sheet and the G-chord handler come from one array', () => {
  it('builds GO_TO from `shortcuts`, so a listed chord is a routed chord', () => {
    expect(SOURCE).toContain('const GO_TO = new Map(shortcuts.map(');
  });

  it('renders the sheet from the same array', () => {
    expect(SOURCE).toContain('{shortcuts.map((s) => (');
  });

  it('declares the chord table exactly once', () => {
    expect(SOURCE.match(/const shortcuts:/g)).toHaveLength(1);
  });
});

describe('the chords follow the new IA', () => {
  const table = chords();

  it('has the Phase 3 map and nothing else', () => {
    expect(table.map((c) => `${c.key} ${c.href}`)).toEqual([
      'G H /',
      'G N /needs-you',
      'G P /projects',
      'G L /library',
      'G C /crew',
      'G S /settings',
      'G R /runs',
      'G B /brain-dump',
    ]);
  });

  it('points every chord at a route with a rail home', () => {
    for (const { key, href } of table) {
      expect([key, railKeyFor(href)]).not.toContain(null);
    }
  });

  it('keeps no chord for a retired surface — a shortcut that only redirects lies about where it goes', () => {
    const retired = ['/deck', '/inbox', '/objectives', '/board', '/board/matrix'];
    expect(table.filter((c) => retired.includes(c.href))).toEqual([]);
  });

  it('uses each letter once, so no chord silently shadows another', () => {
    const letters = table.map((c) => c.key.split(' ')[1]);
    expect(new Set(letters).size).toBe(letters.length);
  });
});

describe('the sheet documents the modifier shortcuts other components own', () => {
  it('lists ⌘K, ⌘P and ⌘J as text, and renders them from their own array', () => {
    expect(SOURCE).toContain('{MODIFIERS.map((m) => (');
    for (const key of ['⌘ K', '⌘ P', '⌘ J']) {
      expect(SOURCE).toContain(`key: '${key}'`);
    }
  });
});
