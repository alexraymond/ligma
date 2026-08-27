/**
 * Structured subtask progress (F1).
 *
 * Denying tasks.json to the builder (D7) killed the dashboard's live subtask
 * ticking. It comes back as STRUCTURE the builder emits — never as prose the
 * daemon pattern-matches: the builder ends its summary with a fenced
 * {"completedSubtaskIds": [...]} block and the daemon applies it.
 */

import { describe, expect, it } from 'vitest';
import { parseCompletedSubtaskIds } from '../src/engine/prompt-builder';

/** What `claude -p --output-format json` actually hands back. */
const envelope = (reply: string): string => JSON.stringify({ type: 'result', result: reply });
const block = (json: unknown): string => `\`\`\`json\n${JSON.stringify(json)}\n\`\`\``;

describe('parseCompletedSubtaskIds', () => {
  it('reads the ids out of a valid block', () => {
    const reply = `Done with the first and third steps.\n\n${block({ completedSubtaskIds: ['st_1', 'st_3'] })}`;
    expect(parseCompletedSubtaskIds(envelope(reply))).toEqual(['st_1', 'st_3']);
  });

  it("reads an empty array as 'finished nothing'", () => {
    expect(parseCompletedSubtaskIds(envelope(block({ completedSubtaskIds: [] })))).toEqual([]);
  });

  it('returns nothing when the block is absent — no guessing from prose', () => {
    expect(
      parseCompletedSubtaskIds(envelope('I finished subtask st_1 and also st_2, all good!')),
    ).toEqual([]);
  });

  it('returns nothing for a malformed block instead of throwing', () => {
    const broken = envelope('here:\n\n```json\n{ "completedSubtaskIds": ["st_1",\n```');
    expect(() => parseCompletedSubtaskIds(broken)).not.toThrow();
    expect(parseCompletedSubtaskIds(broken)).toEqual([]);
    expect(parseCompletedSubtaskIds(envelope(block({ completedSubtaskIds: 'st_1' })))).toEqual([]);
    expect(parseCompletedSubtaskIds(envelope(block({ somethingElse: ['st_1'] })))).toEqual([]);
    expect(parseCompletedSubtaskIds('')).toEqual([]);
  });

  it('drops non-strings and blanks, trims and dedupes', () => {
    const reply = block({ completedSubtaskIds: ['st_1', ' st_1 ', '', '   ', 7, null, 'st_2'] });
    expect(parseCompletedSubtaskIds(envelope(reply))).toEqual(['st_1', 'st_2']);
  });

  it('returns ids it cannot vouch for verbatim — the caller filters by task', () => {
    // Documented contract: stdout is all this sees, so an id from another task
    // (or an invented one) comes back and the applying caller ignores it.
    const reply = block({
      completedSubtaskIds: ['st_1', 'st_of_another_task', '../../etc/passwd'],
    });
    expect(parseCompletedSubtaskIds(envelope(reply))).toEqual([
      'st_1',
      'st_of_another_task',
      '../../etc/passwd',
    ]);
  });

  it("takes the LAST block, so the SOP's own example is not mistaken for the answer", () => {
    const reply = `The format is ${block({ completedSubtaskIds: ['st_1', 'st_3'] })} and mine is ${block(
      {
        completedSubtaskIds: ['st_2'],
      },
    )}`;
    expect(parseCompletedSubtaskIds(envelope(reply))).toEqual(['st_2']);
  });

  it('works on the raw event-array stdout shape too', () => {
    const stdout = JSON.stringify([
      { type: 'system', subtype: 'init' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } },
      { type: 'result', result: `all set\n\n${block({ completedSubtaskIds: ['st_9'] })}` },
    ]);
    expect(parseCompletedSubtaskIds(stdout)).toEqual(['st_9']);
  });
});
