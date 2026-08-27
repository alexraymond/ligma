/**
 * Dispatch gating on pending decisions (fix I14).
 *
 * `blocksTask: false` is self-reported, so an agent that mis-judges it keeps
 * getting dispatched and keeps re-raising the same question. The field stays —
 * it is what lets an agent work on the unblocked parts — but the re-raise is now
 * bounded.
 */

import { describe, expect, it } from 'vitest';
import { decisionBlockReason } from '../src/engine/prompt-builder';

describe('decisionBlockReason', () => {
  it('does not block on nothing pending', () => {
    expect(decisionBlockReason([])).toBeNull();
  });

  it('blocks on a decision the agent called blocking', () => {
    expect(decisionBlockReason([{ blocksTask: true }])).toMatch(/blocks the whole task/);
  });

  it('treats a missing blocksTask as blocking (legacy and human-raised)', () => {
    expect(decisionBlockReason([{}])).toMatch(/blocks the whole task/);
  });

  it('lets work continue while a couple of non-blocking questions wait', () => {
    expect(decisionBlockReason([{ blocksTask: false }, { blocksTask: false }])).toBeNull();
  });

  it('stops dispatch once the same task has piled up three unanswered questions', () => {
    const reason = decisionBlockReason([
      { blocksTask: false },
      { blocksTask: false },
      { blocksTask: false },
    ]);
    expect(reason).toMatch(/3 pending decisions are unanswered/);
  });
});
