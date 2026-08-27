// Objectives retired into the portfolio grid's goals view (CONTRACTS-phase3,
// UX spec §16). No jsdom in this vitest config (node environment only), so
// this reads the page source with fs rather than rendering it — same pattern
// as projects/[id]/board/board-helpers.test.ts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(path.resolve(__dirname, './page.tsx'), 'utf-8');

describe('objectives redirect shell', () => {
  it("redirects to the portfolio grid's goals view", () => {
    expect(SOURCE).toContain("redirect('/projects?view=goals')");
  });
});
