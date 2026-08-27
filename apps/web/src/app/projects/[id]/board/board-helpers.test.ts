// Pins the WIRING for F4: the project board's Done column must collapse the
// same way the global board's does. `visibleColumnTasks`/`sortByCompletedRecency`/
// `DONE_COLLAPSE_LIMIT` are pure helpers already covered end-to-end (25 tasks
// -> 20/25) by board-view.test.ts — what's missing here is proof this page
// actually calls them rather than reimplementing the collapse locally. No
// jsdom in this vitest config (node environment only), so this reads the page
// source with fs rather than rendering it.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(path.resolve(__dirname, './page.tsx'), 'utf-8');

describe('project board Done column — wiring', () => {
  it('references the shared collapse helpers, not a local reimplementation', () => {
    expect(SOURCE).toContain('DONE_COLLAPSE_LIMIT');
    expect(SOURCE).toContain('sortByCompletedRecency');
    expect(SOURCE).toContain('visibleColumnTasks');
  });
});
