/**
 * Wiring proofs for the Build stage's header and Plan view.
 *
 * The stop/start verbs moved here from the project Overview page (which is now
 * a redirect), so its `page.test.ts` assertions move with them: F1
 * (UX-REDESIGN §16) — never the bare word "Pause", and the paused state states
 * the true dispatch-gate semantic (5e607ec). No jsdom in this vitest config
 * (node only), so this reads the source with fs rather than rendering it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(path.resolve(__dirname, './page.tsx'), 'utf-8');

describe('Build stage — stop/start verbs', () => {
  it('never labels a button with the bare word Pause', () => {
    expect(SOURCE).not.toMatch(/>\s*Pause\s*</);
    expect(SOURCE).not.toContain('"Pause"');
  });

  it("uses the deliberate 'Stop starting new work' verb, not a generic stop", () => {
    expect(SOURCE).toContain('Stop starting new work');
  });

  it('offers Resume out of the paused state', () => {
    expect(SOURCE).toContain('Resume');
  });

  it('states the true paused semantic — dispatch gate only, running agents untouched', () => {
    expect(SOURCE).toContain('nothing new starts');
    expect(SOURCE).toContain('running agents finish');
  });
});

describe('Build stage — views and copy', () => {
  it('offers Flow and Plan as the two views, with the matrix as a lens inside Flow', () => {
    expect(SOURCE).toContain('<TabsTrigger value="flow">Flow</TabsTrigger>');
    expect(SOURCE).toContain('<TabsTrigger value="plan">Plan</TabsTrigger>');
    expect(SOURCE).toContain('<TabsTrigger value="priority-matrix">');
    // The lens lives inside the Flow tab, not beside it.
    expect(SOURCE.indexOf('value="flow"')).toBeLessThan(SOURCE.indexOf('value="priority-matrix"'));
  });

  it('keeps drag and drop on both Flow lenses', () => {
    expect(SOURCE).toContain('handleKanbanDragEnd');
    expect(SOURCE).toContain('handleEisenhowerDragEnd');
  });

  it('states the no-estimates promise where a PM looks — the Plan view header', () => {
    expect(SOURCE).toMatch(
      /estimate dates — the machine reports what happened, it does not promise\s+what will/,
    );
  });

  it('mounts the Build drawers', () => {
    expect(SOURCE).toContain("panels={['notes', 'terminal', 'runs']}");
  });
});
