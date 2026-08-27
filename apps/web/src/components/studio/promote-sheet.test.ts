// F1 (UX-REDESIGN §16): promote sheet rewritten in plain language, with the
// isolation sentence and a reversibility line. Pins the two exported copy
// constants and proves the component actually renders them, plus that the
// rewritten header keeps the honest mechanism (contract/oracle) subordinate
// rather than deleted (§17.1 — rewrite jargon, never drop it).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROMOTE_ISOLATION_SENTENCE, PROMOTE_REVERSIBILITY_LINE } from './promote-sheet';

const SOURCE = readFileSync(path.resolve(__dirname, './promote-sheet.tsx'), 'utf-8');

describe('promote sheet copy', () => {
  it('states the true isolation semantic — not a fictional per-task worktree copy', () => {
    expect(PROMOTE_ISOLATION_SENTENCE).toContain("straight into this project's own repo on disk");
    expect(PROMOTE_ISOLATION_SENTENCE).toContain('GitHub');
    expect(SOURCE).toContain('{PROMOTE_ISOLATION_SENTENCE}');
  });

  it("states what does and doesn't undo after promote", () => {
    expect(PROMOTE_REVERSIBILITY_LINE).toContain('deleted');
    expect(PROMOTE_REVERSIBILITY_LINE).toContain('pausing the project');
    expect(SOURCE).toContain('{PROMOTE_REVERSIBILITY_LINE}');
  });

  it('keeps the honest mechanism (contract, oracle) subordinate in the header, not deleted', () => {
    expect(SOURCE).toMatch(/signed contract\s+with a frozen oracle/);
  });
});
