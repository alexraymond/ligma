// F1 (UX-REDESIGN §16): the Paused option in the project-status select must
// state the true dispatch-gate semantic fixed in 5e607ec — dispatch stops,
// running agents don't — not just the bare word "Paused". No jsdom in this
// vitest config (node environment only), so this reads the component source
// with fs rather than rendering it — same pattern as governor-card.test.ts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(path.resolve(__dirname, './edit-project-dialog.tsx'), 'utf-8');

describe('edit project dialog — Paused status copy', () => {
  it('still offers the four statuses, Paused included', () => {
    expect(SOURCE).toContain('<SelectItem value="paused">Paused</SelectItem>');
  });

  it('explains the true semantic when Paused is selected', () => {
    expect(SOURCE).toContain('Nothing new starts');
    expect(SOURCE).toContain('running agents finish');
    expect(SOURCE).toMatch(/pending tasks and due retries stay\s+queued/);
  });
});
