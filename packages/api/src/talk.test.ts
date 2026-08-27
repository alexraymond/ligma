import { describe, expect, it } from 'vitest';
import { type TalkChip, isTalkChipKind, parseTalkReply, talkChipHref } from './talk';

describe('talkChipHref', () => {
  const cases: Array<[TalkChip, string]> = [
    [{ kind: 'task', id: 'task_1' }, '/board?task=task_1'],
    [{ kind: 'run', id: 'run_1' }, '/runs'],
    [{ kind: 'verdict', id: 'vrun_123' }, '/verification/vrun_123'],
    [{ kind: 'design', id: 'dsn_9' }, '/projects/proj_a/studio?design=dsn_9'],
  ];

  for (const [chip, href] of cases) {
    it(`sends a ${chip.kind} chip to ${href}`, () => {
      expect(talkChipHref(chip, 'proj_a')).toBe(href);
    });
  }

  it('encodes ids and project ids rather than splicing them raw', () => {
    expect(talkChipHref({ kind: 'task', id: 'a/b?c' }, 'proj_a')).toBe('/board?task=a%2Fb%3Fc');
    expect(talkChipHref({ kind: 'design', id: 'd 1' }, 'p/1')).toBe(
      '/projects/p%2F1/studio?design=d%201',
    );
  });

  it("matches lib/nav's recordHref shape for tasks", () => {
    // The chip and the ⌘K search result must land on the same surface.
    expect(talkChipHref({ kind: 'task', id: 't1' }, 'p')).toBe(
      `/board?task=${encodeURIComponent('t1')}`,
    );
  });
});

describe('isTalkChipKind', () => {
  it('accepts the four kinds and nothing else', () => {
    expect(['task', 'run', 'verdict', 'design'].every(isTalkChipKind)).toBe(true);
    expect(isTalkChipKind('decision')).toBe(false);
    expect(isTalkChipKind(null)).toBe(false);
    expect(isTalkChipKind(1)).toBe(false);
  });
});

describe('parseTalkReply', () => {
  it('accepts a bare reply and defaults chips to []', () => {
    expect(parseTalkReply({ reply: '  hello  ' })).toEqual({ reply: 'hello', chips: [] });
  });

  it('accepts a reply with chips, trimming ids and dropping blank labels', () => {
    expect(
      parseTalkReply({
        reply: 'see these',
        chips: [
          { kind: 'task', id: ' task_1 ', label: ' Fix login ' },
          { kind: 'verdict', id: 'vrun_2', label: '   ' },
        ],
      }),
    ).toEqual({
      reply: 'see these',
      chips: [
        { kind: 'task', id: 'task_1', label: 'Fix login' },
        { kind: 'verdict', id: 'vrun_2' },
      ],
    });
  });

  it('treats a null/absent chips field as no chips', () => {
    expect(parseTalkReply({ reply: 'x', chips: null }).chips).toEqual([]);
  });

  const rejected: Array<[string, unknown]> = [
    ['not an object', 'hello'],
    ['an array', [{ reply: 'x' }]],
    ['null', null],
    ['a missing reply', { chips: [] }],
    ['a non-string reply', { reply: 42 }],
    ['an empty reply', { reply: '   ' }],
    ['an over-long reply', { reply: 'x'.repeat(4001) }],
    ['chips that are not an array', { reply: 'x', chips: { kind: 'task', id: 't' } }],
    [
      'too many chips',
      { reply: 'x', chips: Array.from({ length: 9 }, () => ({ kind: 'task', id: 't' })) },
    ],
    ['a chip that is not an object', { reply: 'x', chips: ['task_1'] }],
    ['an unknown chip kind', { reply: 'x', chips: [{ kind: 'decision', id: 'd1' }] }],
    ['a chip with no id', { reply: 'x', chips: [{ kind: 'task', id: '  ' }] }],
    ['a chip with an over-long id', { reply: 'x', chips: [{ kind: 'task', id: 't'.repeat(121) }] }],
    [
      'a chip with a non-string label',
      { reply: 'x', chips: [{ kind: 'task', id: 't', label: 3 }] },
    ],
  ];

  for (const [what, value] of rejected) {
    it(`rejects ${what}`, () => {
      expect(() => parseTalkReply(value)).toThrow(/Talk reply invalid/);
    });
  }
});
