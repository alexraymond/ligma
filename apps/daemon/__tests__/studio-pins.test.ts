/**
 * Pin compilation — the apply-preview's whole reason to exist.
 *
 * UX spec F4 names ligma-classic's opacity as the defect: "Apply (N)" sent a
 * compiled instruction block the user never saw. The fix is not a nicer summary,
 * it is that the preview endpoint and the apply turn call ONE function. So this
 * file golden-tests that function's exact output — if the compiled string
 * changes, the preview changes with it or the test fails.
 */

import type { DesignPin } from '@ligma/api';
import { describe, expect, it } from 'vitest';
import { buildInstructionPreview, compilePinInstruction } from '../src/studio/prompt';

function pin(overrides: Partial<DesignPin> & Pick<DesignPin, 'id' | 'text'>): DesignPin {
  return {
    filePath: 'index.html',
    selector: '#hero > h1',
    tag: 'h1',
    outerHTML: '<h1>Welcome</h1>',
    parentOuterHTML: null,
    scope: 'element',
    status: 'pending',
    createdAt: '2026-08-11T00:00:00.000Z',
    appliedInVersionId: null,
    ...overrides,
  };
}

describe('compilePinInstruction', () => {
  it('passes a bare prompt through untouched when nothing is staged', () => {
    expect(compilePinInstruction('make it warmer', [])).toBe('make it warmer');
  });

  it('returns an empty string for an empty prompt and no pins', () => {
    expect(compilePinInstruction('', [])).toBe('');
  });

  it('compiles one pin into the exact instruction block', () => {
    const out = compilePinInstruction('', [pin({ id: 'p1', text: 'make this bigger' })]);
    expect(out).toBe(
      [
        '## REQUIRED EDITS — you MUST apply every edit below (1 across 1 file(s))',
        '',
        'Each edit targets a specific element identified by its selector and outerHTML.',
        'Read the file with `read_file`, apply every edit, then save it with `write_file`.',
        'Do NOT skip any edit, and do NOT change anything an edit did not ask for.',
        '',
        '## File: index.html',
        '',
        '### Edit 1: make this bigger',
        '- **Target**: `<h1>` at `#hero > h1`',
        '- **Current HTML**: `<h1>Welcome</h1>`',
        '- **Scope**: element (this element only)',
        '- **Instruction**: make this bigger',
        '',
      ].join('\n'),
    );
  });

  it('groups pins by file and numbers them continuously across files', () => {
    const out = compilePinInstruction('', [
      pin({ id: 'p1', text: 'first', filePath: 'a.html' }),
      pin({ id: 'p2', text: 'second', filePath: 'b.html' }),
      pin({ id: 'p3', text: 'third', filePath: 'a.html' }),
    ]);
    expect(out).toContain('(3 across 2 file(s))');
    // a.html's two pins stay together, and numbering does not restart per file.
    expect(out.indexOf('## File: a.html')).toBeLessThan(out.indexOf('## File: b.html'));
    expect(out).toContain('### Edit 1: first');
    expect(out).toContain('### Edit 2: third');
    expect(out).toContain('### Edit 3: second');
  });

  it('includes parent context only when the overlay captured it', () => {
    const without = compilePinInstruction('', [pin({ id: 'p1', text: 'x' })]);
    expect(without).not.toContain('Parent context');
    const with_ = compilePinInstruction('', [
      pin({ id: 'p1', text: 'x', parentOuterHTML: '<div id=hero>…</div>' }),
    ]);
    expect(with_).toContain('- **Parent context**: `<div id=hero>…</div>`');
  });

  it('labels a global pin as design-wide', () => {
    expect(compilePinInstruction('', [pin({ id: 'p1', text: 'x', scope: 'global' })])).toContain(
      '- **Scope**: global (apply design-wide)',
    );
  });

  it('truncates oversized HTML to keep one pin from eating the context window', () => {
    const out = compilePinInstruction('', [
      pin({ id: 'p1', text: 'x', outerHTML: '<p>'.repeat(500) }),
    ]);
    const line = out.split('\n').find((l) => l.startsWith('- **Current HTML**'))!;
    expect(line).toContain('…');
    expect(line.length).toBeLessThan(700);
  });

  it('appends the free-text prompt after a separator when there is one', () => {
    const out = compilePinInstruction('also tighten the spacing', [pin({ id: 'p1', text: 'x' })]);
    expect(out.endsWith('---\n\nalso tighten the spacing')).toBe(true);
  });

  it("omits the separator when the prompt is blank — the Apply button's shape", () => {
    expect(compilePinInstruction('   ', [pin({ id: 'p1', text: 'x' })])).not.toContain('---');
  });
});

describe('buildInstructionPreview', () => {
  it('returns byte-for-byte what the turn would send, plus its inputs', () => {
    const pins = [pin({ id: 'p1', text: 'one' }), pin({ id: 'p2', text: 'two' })];
    const preview = buildInstructionPreview('dsn_1', 'and this', pins);
    expect(preview.designId).toBe('dsn_1');
    expect(preview.pinIds).toEqual(['p1', 'p2']);
    expect(preview.userPrompt).toBe('and this');
    // The load-bearing assertion: the preview IS the payload.
    expect(preview.instruction).toBe(compilePinInstruction('and this', pins));
  });
});
