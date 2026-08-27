/**
 * The scoped tool registry — the security boundary of the whole studio.
 *
 * Everything a generation turn does to the filesystem goes through these four
 * tools, so "can a crafted path reach outside the design directory" is the
 * question this file exists to answer. It is asked in every spelling that has
 * historically worked: plain `..`, mixed segments, absolute paths, a NUL-byte
 * truncation, and a symlink planted inside the tree pointing out of it.
 */

import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveInsideRoot, toDesignRelative } from '../src/studio/paths';
import {
  createCriticToolRegistry,
  createDesignToolRegistry,
  parseCritiqueSubmission,
  parseTweakSchema,
  requireTool,
} from '../src/studio/tools';

let root = '';
let outside = '';
const ctx = { signal: new AbortController().signal };

beforeAll(async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'ligma-studio-tools-'));
  root = path.join(base, 'design', 'src');
  outside = path.join(base, 'outside');
  await mkdir(root, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(outside, 'secret.txt'), 'holdout criteria live here', 'utf-8');
});

afterAll(async () => {
  if (root) await rm(path.resolve(root, '..', '..'), { recursive: true, force: true });
});

// ─── The containment primitive ───────────────────────────────────────────────

describe('resolveInsideRoot', () => {
  it('resolves an ordinary relative path inside the root', () => {
    expect(resolveInsideRoot('/designs/d1', 'screens/home.html')).toBe(
      '/designs/d1/screens/home.html',
    );
  });

  it.each([
    ['parent traversal', '../secret.txt'],
    ['deep traversal', 'a/b/../../../../etc/passwd'],
    ['dot-segment padding', './././../x'],
    ['absolute path', '/etc/passwd'],
    ['windows drive', 'C:\\Windows\\system32'],
    ['UNC path', '\\\\server\\share'],
    ['NUL byte', 'ok.html\u0000/../../etc/passwd'],
    ['empty', ''],
    ['whitespace only', '   '],
  ])('rejects %s', (_label, attempt) => {
    expect(() => resolveInsideRoot('/designs/d1', attempt)).toThrow();
  });

  it('does not treat a sibling with a shared prefix as inside', () => {
    // The classic off-by-one: "/designs/d1-evil" starts with "/designs/d1".
    expect(() => resolveInsideRoot('/designs/d1', '../d1-evil/x.html')).toThrow(/escapes/);
  });

  it('normalises a path back to POSIX form relative to the root', () => {
    expect(toDesignRelative('/designs/d1', path.join('/designs/d1', 'a', 'b.html'))).toBe(
      'a/b.html',
    );
  });
});

// ─── The tools ───────────────────────────────────────────────────────────────

describe('design tool registry', () => {
  it('registers exactly the generation tools', () => {
    const names = createDesignToolRegistry(root)
      .list()
      .map((t) => t.name)
      .sort();
    expect(names).toEqual(['declare_tweak_schema', 'list_files', 'read_file', 'write_file']);
  });

  it('writes a file and reports progress', async () => {
    const seen: Array<[string, number]> = [];
    const registry = createDesignToolRegistry(root, { onFileWritten: (p, b) => seen.push([p, b]) });
    const result = await requireTool(registry, 'write_file').run(
      { path: 'screens/home.html', content: '<h1>hi</h1>' },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(seen).toEqual([['screens/home.html', 11]]);
    expect(await readFile(path.join(root, 'screens', 'home.html'), 'utf-8')).toBe('<h1>hi</h1>');
  });

  it('reads back what it wrote and lists it', async () => {
    const registry = createDesignToolRegistry(root);
    await requireTool(registry, 'write_file').run({ path: 'a.html', content: 'A' }, ctx);
    expect((await requireTool(registry, 'read_file').run({ path: 'a.html' }, ctx)).result).toBe(
      'A',
    );
    const listed = await requireTool(registry, 'list_files').run({}, ctx);
    expect(listed.result).toContain('a.html');
  });

  it('refuses to write outside the design directory', async () => {
    const registry = createDesignToolRegistry(root);
    const result = await requireTool(registry, 'write_file').run(
      { path: '../../outside/pwned.html', content: 'x' },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/escapes the design directory/);
  });

  it('refuses to read outside the design directory', async () => {
    const registry = createDesignToolRegistry(root);
    const result = await requireTool(registry, 'read_file').run(
      { path: '../../outside/secret.txt' },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/escapes the design directory/);
  });

  it('refuses a symlink that points out of the tree', async () => {
    // The lexical path is innocent — only realpath catches this one.
    await symlink(outside, path.join(root, 'escape-hatch'), 'dir').catch(() => undefined);
    const registry = createDesignToolRegistry(root);
    const result = await requireTool(registry, 'write_file').run(
      { path: 'escape-hatch/pwned.html', content: 'x' },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/resolves outside the design directory/);
  });

  it('returns an error rather than throwing on a bad argument', async () => {
    const registry = createDesignToolRegistry(root);
    const result = await requireTool(registry, 'write_file').run({ content: 'no path' }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/`path` must be a string/);
  });

  it('caps a single file so runaway output cannot fill the disk', async () => {
    const registry = createDesignToolRegistry(root);
    const result = await requireTool(registry, 'write_file').run(
      { path: 'huge.html', content: 'x'.repeat(2_000_001) },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/per-file limit/);
  });

  it('serialises writes and parallelises reads', () => {
    const registry = createDesignToolRegistry(root);
    expect(requireTool(registry, 'write_file').isConcurrencySafe({})).toBe(false);
    expect(requireTool(registry, 'read_file').isConcurrencySafe({})).toBe(true);
    expect(requireTool(registry, 'list_files').isConcurrencySafe({})).toBe(true);
  });
});

// ─── The critic's registry ───────────────────────────────────────────────────

describe('critic tool registry', () => {
  it('has no way to write — a grader that can edit its subject is not a grader', () => {
    const names = createCriticToolRegistry(root, () => {})
      .list()
      .map((t) => t.name)
      .sort();
    expect(names).toEqual(['list_files', 'read_file', 'submit_critique']);
    expect(names).not.toContain('write_file');
  });

  it('captures a valid submission', async () => {
    let captured: unknown = null;
    const registry = createCriticToolRegistry(root, (v) => (captured = v));
    const result = await requireTool(registry, 'submit_critique').run(
      { score: 82, rules: [{ rule: 'color', score: 90, note: 'good contrast' }] },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(captured).toEqual({
      score: 82,
      rules: [{ rule: 'color', score: 90, note: 'good contrast' }],
    });
  });
});

// ─── Structured-output validation ────────────────────────────────────────────

describe('parseCritiqueSubmission', () => {
  it('accepts a well-formed submission and defaults a missing note', () => {
    expect(
      parseCritiqueSubmission({ score: 70, rules: [{ rule: 'typography', score: 65 }] }),
    ).toEqual({
      score: 70,
      rules: [{ rule: 'typography', score: 65, note: '' }],
    });
  });

  it.each([
    ['a missing score', { rules: [{ rule: 'color', score: 1 }] }],
    ['a score out of range', { score: 101, rules: [{ rule: 'color', score: 1 }] }],
    ['a non-numeric score', { score: 'great', rules: [{ rule: 'color', score: 1 }] }],
    ['no rules', { score: 70, rules: [] }],
    ['a rule without a name', { score: 70, rules: [{ score: 1 }] }],
  ])('rejects %s outright rather than salvaging a number', (_label, input) => {
    expect(() => parseCritiqueSubmission(input)).toThrow();
  });
});

describe('parseTweakSchema', () => {
  it('keeps the declared control and defaults `live` to true', () => {
    expect(parseTweakSchema({ schema: { accent: { kind: 'color' } } })).toEqual({
      accent: { kind: 'color', live: true },
    });
  });

  it('carries numeric bounds through', () => {
    expect(
      parseTweakSchema({
        schema: { radius: { kind: 'number', min: 0, max: 24, step: 2, unit: 'px' } },
      }),
    ).toEqual({
      radius: { kind: 'number', live: true, min: 0, max: 24, step: 2, unit: 'px' },
    });
  });

  it('honours an explicit `live: false`', () => {
    expect(
      parseTweakSchema({
        schema: { layout: { kind: 'enum', options: ['grid', 'list'], live: false } },
      }),
    ).toEqual({
      layout: { kind: 'enum', live: false, options: ['grid', 'list'] },
    });
  });

  it.each([
    ['an empty schema', { schema: {} }],
    ['an unknown kind', { schema: { x: { kind: 'slider' } } }],
    ['an enum with no options', { schema: { x: { kind: 'enum' } } }],
  ])('rejects %s', (_label, input) => {
    expect(() => parseTweakSchema(input)).toThrow();
  });
});
