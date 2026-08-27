/**
 * The oracle must not leak into the builder's reading material (D7, fix #2).
 *
 * Two cheap structural checks that would have caught the leak: the context
 * generator must not know about acceptance criteria at all, and the generated
 * context must not contain any of them.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { DATA_DIR } from '../src/paths';
const GENERATOR = path.resolve(__dirname, '../scripts/generate-context.ts');

const generatedContexts = ['ai-context.md', 'ai-context-readable.md']
  .map((f) => path.join(DATA_DIR, f))
  .filter(existsSync);

describe('generated agent context', () => {
  it('the generator never touches task.acceptanceCriteria', () => {
    const source = readFileSync(GENERATOR, 'utf-8');
    // Only comments may mention it (the field is deliberately unmodelled).
    const codeLines = source
      .split('\n')
      .filter(
        (l) =>
          !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'),
      );
    expect(codeLines.join('\n')).not.toContain('acceptanceCriteria');
  });

  it("contains none of the tasks' acceptance criteria", () => {
    const { tasks } = JSON.parse(readFileSync(path.join(DATA_DIR, 'tasks.json'), 'utf-8')) as {
      tasks: Array<{ acceptanceCriteria?: string[] }>;
    };
    // Short strings can collide with ordinary prose; long ones cannot.
    const criteria = tasks.flatMap((t) => t.acceptanceCriteria ?? []).filter((c) => c.length > 25);

    for (const file of generatedContexts) {
      const content = readFileSync(file, 'utf-8');
      for (const criterion of criteria) {
        expect(content, `${path.basename(file)} leaks a criterion`).not.toContain(criterion);
      }
    }
  });
});
