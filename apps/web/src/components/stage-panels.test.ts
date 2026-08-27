/**
 * `panelHref` — pure, DOM-free. Pins the exact absorbed-tab targets
 * CONTRACTS-phase3 lists, so a redirect shell and the drawer host can't drift
 * apart on the query param shape.
 */
import { describe, expect, it } from 'vitest';
import { panelHref } from './stage-panels';

describe('panelHref', () => {
  it('builds the references drawer target on Brief', () => {
    expect(panelHref('proj_1', 'brief', 'references')).toBe(
      '/projects/proj_1/brief?panel=references',
    );
  });

  it('builds the design-files drawer target on Studio', () => {
    expect(panelHref('proj_1', 'studio', 'design-files')).toBe(
      '/projects/proj_1/studio?panel=design-files',
    );
  });

  it('builds the notes/terminal/runs drawer targets on Build', () => {
    expect(panelHref('proj_1', 'board', 'notes')).toBe('/projects/proj_1/board?panel=notes');
    expect(panelHref('proj_1', 'board', 'terminal')).toBe('/projects/proj_1/board?panel=terminal');
    expect(panelHref('proj_1', 'board', 'runs')).toBe('/projects/proj_1/board?panel=runs');
  });

  it('builds the knowledge drawer target on Proof', () => {
    expect(panelHref('proj_1', 'verify', 'knowledge')).toBe(
      '/projects/proj_1/verify?panel=knowledge',
    );
  });
});
