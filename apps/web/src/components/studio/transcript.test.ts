import type { DesignTranscriptEntry, DesignTranscriptPart } from '@ligma/api';
/**
 * The fold is the whole contract between "live" and "after a reload": the SSE
 * lane and `GET .../transcript` hand over identical append records, and this
 * turns them into messages. If the two disagreed the pane would rewrite itself
 * on refresh, which is the bug a transcript exists to prevent.
 */
import { describe, expect, it } from 'vitest';
import { foldTranscript, mergeEntry, messageCopyText, userPromptFor } from './transcript';

let clock = 0;
function entry(
  role: DesignTranscriptEntry['role'],
  part: DesignTranscriptPart,
  turnId = 'dt_1',
): DesignTranscriptEntry {
  clock += 1;
  return { designId: 'd1', turnId, role, at: new Date(clock * 1000).toISOString(), part };
}

const text = (t: string): DesignTranscriptPart => ({ kind: 'text', text: t, truncated: false });
const thinking = (t: string): DesignTranscriptPart => ({
  kind: 'thinking',
  text: t,
  truncated: false,
});
const tool = (id: string, status: 'running' | 'ok' | 'error'): DesignTranscriptPart => ({
  kind: 'tool',
  toolUseId: id,
  toolName: 'write_file',
  summary: 'index.html',
  status,
});

describe('foldTranscript', () => {
  it("splits a turn into the user's message and the designer's reply", () => {
    const messages = foldTranscript([
      entry('user', text('a landing page')),
      entry('designer', text('Writing it.')),
    ]);
    expect(messages.map((m) => m.role)).toEqual(['user', 'designer']);
    expect(messages[0]!.parts).toEqual([text('a landing page')]);
  });

  it('merges adjacent prose into one block but keeps a tool call between two blocks apart', () => {
    const messages = foldTranscript([
      entry('designer', text('Writing ')),
      entry('designer', text('the page.')),
      entry('designer', tool('t1', 'running')),
      entry('designer', text('Done.')),
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.parts).toEqual([
      text('Writing the page.'),
      tool('t1', 'running'),
      text('Done.'),
    ]);
  });

  it('keeps thinking separate from prose even when they are adjacent', () => {
    const messages = foldTranscript([
      entry('designer', thinking('hmm')),
      entry('designer', text('ok')),
    ]);
    expect(messages[0]?.parts).toEqual([thinking('hmm'), text('ok')]);
  });

  it('updates a tool card in place when its outcome lands, rather than showing it twice', () => {
    const messages = foldTranscript([
      entry('designer', tool('t1', 'running')),
      entry('designer', tool('t2', 'running')),
      entry('designer', tool('t1', 'ok')),
      entry('designer', tool('t2', 'error')),
    ]);
    expect(messages[0]!.parts).toEqual([tool('t1', 'ok'), tool('t2', 'error')]);
  });

  it('lifts the done entry onto the message instead of rendering it as a part', () => {
    const messages = foldTranscript([
      entry('designer', text('tried')),
      entry('designer', { kind: 'done', stopReason: 'error', error: 'governor deferred it' }),
    ]);
    expect(messages[0]!.parts).toEqual([text('tried')]);
    expect(messages[0]!.stopReason).toBe('error');
    expect(messages[0]!.error).toBe('governor deferred it');
  });

  it('starts a new message per turn, so two turns never run together', () => {
    const messages = foldTranscript([
      entry('user', text('first'), 'dt_1'),
      entry('designer', text('one'), 'dt_1'),
      entry('user', text('second'), 'dt_2'),
      entry('designer', text('two'), 'dt_2'),
    ]);
    expect(messages.map((m) => `${m.turnId}:${m.role}`)).toEqual([
      'dt_1:user',
      'dt_1:designer',
      'dt_2:user',
      'dt_2:designer',
    ]);
  });

  it('is stable under replay: folding twice gives the same answer', () => {
    const entries = [
      entry('user', text('a')),
      entry('designer', text('b')),
      entry('designer', tool('t1', 'ok')),
    ];
    expect(foldTranscript([...entries, ...[]])).toEqual(foldTranscript(entries));
  });
});

describe('mergeEntry', () => {
  it('ignores a duplicate entry, so an SSE replay after reconnect does not double the prose', () => {
    const first = entry('designer', text('hello'));
    expect(mergeEntry([first], first)).toEqual([first]);
  });

  it('appends a new entry', () => {
    const first = entry('designer', text('hello'));
    const second = entry('designer', text(' there'));
    expect(mergeEntry([first], second)).toEqual([first, second]);
  });
});

describe('copy and retry', () => {
  it('copies the prose, not the thinking', () => {
    const [message] = foldTranscript([
      entry('designer', thinking('private')),
      entry('designer', text('Here is the page.')),
    ]);
    expect(messageCopyText(message!)).toBe('Here is the page.');
  });

  it('falls back to the thinking when a turn produced no prose at all', () => {
    const [message] = foldTranscript([entry('designer', thinking('only this'))]);
    expect(messageCopyText(message!)).toBe('only this');
  });

  it('finds the prompt to re-send for a failed turn', () => {
    const messages = foldTranscript([
      entry('user', text('draw it'), 'dt_9'),
      entry('designer', { kind: 'done', stopReason: 'error', error: 'boom' }, 'dt_9'),
    ]);
    expect(userPromptFor(messages, 'dt_9')).toBe('draw it');
    expect(userPromptFor(messages, 'dt_absent')).toBeNull();
  });
});
