// build brief §16 Phase 2: discovery re-presented as a thread must still be
// built from the exact same form scaffolding — QuestionFormCard/AnsweredTurn
// own the Still-needed header, Skip and You-decide affordances (proven at the
// render level in question-form.test.ts), so this page is only wired
// correctly if it still delegates to them rather than reimplementing the
// form. No jsdom in this vitest config (node environment only), so this reads
// the page source with fs — same pattern as the sibling page.test.ts (project
// page) and board-helpers.test.ts wiring proofs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(path.resolve(__dirname, './page.tsx'), 'utf-8');

describe('brief page — discovery thread wiring', () => {
  it('still renders the open form through QuestionFormCard, not a reimplementation', () => {
    expect(SOURCE).toContain('<QuestionFormCard');
  });

  it('still renders answered turns through AnsweredTurn, editable, wired to the amend route', () => {
    expect(SOURCE).toContain('<AnsweredTurn');
    expect(SOURCE).toContain('editable');
    expect(SOURCE).toContain('/api/projects/${projectId}/brief/amend');
  });

  it('offers the manual exit, wired to the same lock the brief already uses', () => {
    expect(SOURCE).toContain('I&apos;ll write the brief myself');
    expect(SOURCE.match(/\{ lock: true \}/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("keeps the stale-brief banner reachable, now also driven by an amendment's response", () => {
    expect(SOURCE).toContain('staleFlaggedAt');
    expect(SOURCE).toContain('staleFlagged');
  });
});
