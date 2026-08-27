/**
 * Phase 3 of the studio parity roadmap: the composer's three daemon-side
 * pieces — reference attachments, `@`-mention skill staging, and the image
 * content blocks those attachments become on the model turn.
 *
 * What is pinned here is what would fail silently otherwise: a staged copy
 * that escapes the design directory, a byte cap that does not bite, an
 * attachment id a turn accepts without ever having seen it, and the shape of
 * the prompt input the SDK is handed. The model wire itself is not exercised —
 * that costs a real turn.
 */

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const central = await mkdtemp(path.join(tmpdir(), 'ligma-composer-data-'));
process.env.LIGMA_DATA_DIR = central;

const {
  MAX_ATTACHMENT_BYTES,
  attachmentsDir,
  listAttachments,
  readAttachmentBase64,
  resolveAttachments,
  saveAttachment,
} = await import('../src/studio/attachments');
const {
  MAX_STAGED_BYTES,
  parseSkillMentions,
  skillStagingPromptLine,
  stageSkills,
  stagedSkillsDir,
} = await import('../src/studio/skill-staging');
const { buildPromptInput } = await import('../src/studio/provider');
const { createDesignToolRegistry } = await import('../src/studio/tools');

const PROJECT = 'proj_composer';
const DESIGN = 'dsn_composer';

/** A 1×1 PNG — real bytes, so the sha and the media type are real too. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

let skills: string;
const realSkillsDir = process.env.LIGMA_SKILLS_DIR;

beforeAll(async () => {
  skills = await mkdtemp(path.join(tmpdir(), 'ligma-composer-skills-'));
  process.env.LIGMA_SKILLS_DIR = skills;

  await mkdir(path.join(skills, 'brainstorming', 'references'), { recursive: true });
  await writeFile(
    path.join(skills, 'brainstorming', 'SKILL.md'),
    '---\nname: brainstorming\n---\n\nAsk first.\n',
  );
  await writeFile(path.join(skills, 'brainstorming', 'references', 'notes.md'), 'notes\n');

  // A package whose extra file blows the budget on its own.
  await mkdir(path.join(skills, 'heavy'), { recursive: true });
  await writeFile(path.join(skills, 'heavy', 'SKILL.md'), '---\nname: heavy\n---\n\nSmall.\n');
  await writeFile(path.join(skills, 'heavy', 'corpus.txt'), 'x'.repeat(MAX_STAGED_BYTES + 1));

  // A directory that is not a skill: no SKILL.md.
  await mkdir(path.join(skills, 'not-a-skill'), { recursive: true });
  await writeFile(path.join(skills, 'not-a-skill', 'README.md'), 'nothing to see\n');
});

afterAll(async () => {
  await rm(skills, { recursive: true, force: true });
  await rm(central, { recursive: true, force: true });
  if (realSkillsDir === undefined) delete process.env.LIGMA_SKILLS_DIR;
  else process.env.LIGMA_SKILLS_DIR = realSkillsDir;
});

beforeEach(async () => {
  await rm(path.join(central, 'projects', PROJECT), { recursive: true, force: true });
});

describe('reference attachments', () => {
  it('stores the bytes content-addressed, outside src/', async () => {
    const saved = await saveAttachment(PROJECT, DESIGN, {
      name: 'hero.png',
      dataUrl: PNG_DATA_URL,
    });
    expect(saved.id).toMatch(/^[0-9a-f]{64}\.png$/);
    expect(saved.mediaType).toBe('image/png');
    expect(saved.byteSize).toBeGreaterThan(0);

    const dir = attachmentsDir(PROJECT, DESIGN);
    expect(dir).not.toContain(`${path.sep}src${path.sep}`);
    expect((await stat(path.join(dir, saved.id))).size).toBe(saved.byteSize);
  });

  it('stores the same image twice as one file', async () => {
    const first = await saveAttachment(PROJECT, DESIGN, { name: 'a.png', dataUrl: PNG_DATA_URL });
    const second = await saveAttachment(PROJECT, DESIGN, { name: 'b.png', dataUrl: PNG_DATA_URL });
    expect(second.id).toBe(first.id);
    expect(await listAttachments(PROJECT, DESIGN)).toHaveLength(1);
  });

  it('refuses a media type the model cannot look at', async () => {
    await expect(
      saveAttachment(PROJECT, DESIGN, {
        name: 'spec.pdf',
        dataUrl: 'data:application/pdf;base64,JVBERi0=',
      }),
    ).rejects.toThrow(/not an image/);
  });

  it('refuses anything that is not a base64 data URL', async () => {
    await expect(
      saveAttachment(PROJECT, DESIGN, { name: 'x.png', dataUrl: 'https://example.com/x.png' }),
    ).rejects.toThrow(/base64/);
  });

  it('refuses an oversized image', async () => {
    const huge = `data:image/png;base64,${'A'.repeat(Math.ceil((MAX_ATTACHMENT_BYTES + 1024) / 3) * 4)}`;
    await expect(
      saveAttachment(PROJECT, DESIGN, { name: 'big.png', dataUrl: huge }),
    ).rejects.toThrow(/cap/);
  });

  it('refuses a turn that names an attachment the design has never seen', async () => {
    const saved = await saveAttachment(PROJECT, DESIGN, {
      name: 'hero.png',
      dataUrl: PNG_DATA_URL,
    });
    const all = await listAttachments(PROJECT, DESIGN);
    expect(resolveAttachments(all, [saved.id])).toHaveLength(1);
    expect(() => resolveAttachments(all, ['../../../etc/passwd'])).toThrow(/Unknown attachment/);
    expect(() => resolveAttachments(all, [`${'0'.repeat(64)}.png`])).toThrow(/Unknown attachment/);
  });

  it('reads back the exact bytes that went in', async () => {
    const saved = await saveAttachment(PROJECT, DESIGN, {
      name: 'hero.png',
      dataUrl: PNG_DATA_URL,
    });
    expect(await readAttachmentBase64(PROJECT, DESIGN, saved)).toBe(PNG_BASE64);
  });
});

describe('@-mentions', () => {
  it('takes ids at a word boundary and leaves email addresses alone', () => {
    expect(parseSkillMentions('use @brainstorming then @anti-ai-slop')).toEqual([
      'brainstorming',
      'anti-ai-slop',
    ]);
    expect(parseSkillMentions('mail alex@tyrell.global')).toEqual([]);
    expect(parseSkillMentions('@a @a @a')).toEqual(['a']);
    expect(parseSkillMentions('nothing here')).toEqual([]);
  });

  it('caps how many one turn honours', () => {
    expect(parseSkillMentions('@a @b @c @d @e @f @g')).toHaveLength(5);
  });
});

describe('skill staging', () => {
  it('copies the package into the design, outside src/, SKILL.md first', async () => {
    const staged = await stageSkills(PROJECT, DESIGN, ['brainstorming']);
    expect(staged).toEqual([
      { id: 'brainstorming', files: ['SKILL.md', 'references/notes.md'], truncated: false },
    ]);

    const root = stagedSkillsDir(PROJECT, DESIGN);
    expect(root).not.toContain(`${path.sep}src${path.sep}`);
    expect(await readFile(path.join(root, 'brainstorming', 'SKILL.md'), 'utf-8')).toContain(
      'Ask first.',
    );
  });

  it('stops at the byte cap and says so', async () => {
    const staged = await stageSkills(PROJECT, DESIGN, ['heavy']);
    expect(staged[0].files).toEqual(['SKILL.md']);
    expect(staged[0].truncated).toBe(true);
    expect(skillStagingPromptLine(staged)).toContain('staging size cap');
  });

  it('is inert for a mention that names nothing, a traversal, or a non-skill', async () => {
    expect(await stageSkills(PROJECT, DESIGN, ['nope'])).toEqual([]);
    expect(await stageSkills(PROJECT, DESIGN, ['../../../etc'])).toEqual([]);
    expect(await stageSkills(PROJECT, DESIGN, ['not-a-skill'])).toEqual([]);
    expect(skillStagingPromptLine([])).toBe('');
  });

  it("replaces the previous turn's staging rather than accumulating", async () => {
    await stageSkills(PROJECT, DESIGN, ['brainstorming']);
    await stageSkills(PROJECT, DESIGN, ['heavy']);
    const root = stagedSkillsDir(PROJECT, DESIGN);
    await expect(stat(path.join(root, 'brainstorming'))).rejects.toThrow();
    await expect(stat(path.join(root, 'heavy', 'SKILL.md'))).resolves.toBeTruthy();
  });

  it('gives the turn a read tool scoped to the staging dir, and only then', async () => {
    const staged = await stageSkills(PROJECT, DESIGN, ['brainstorming']);
    const root = stagedSkillsDir(PROJECT, DESIGN);

    expect(createDesignToolRegistry('/tmp').has('read_staged_skill')).toBe(false);

    const registry = createDesignToolRegistry(path.join(central, 'unused-src'), {
      stagedSkillsRoot: root,
    });
    const tool = registry.get('read_staged_skill');
    expect(tool).toBeDefined();
    expect(staged).toHaveLength(1);

    const signal = new AbortController().signal;
    const ok = await tool?.run({ path: 'brainstorming/SKILL.md' }, { signal });
    expect(ok?.ok).toBe(true);
    expect(String(ok?.result)).toContain('Ask first.');

    const escapeAttempt = await tool?.run({ path: '../design.json' }, { signal });
    expect(escapeAttempt?.ok).toBe(false);
    expect(escapeAttempt?.error).toMatch(/escapes/);
  });
});

describe("the model turn's prompt input", () => {
  it('stays a plain string when nothing is attached', () => {
    expect(buildPromptInput('draw a login', undefined)).toBe('draw a login');
    expect(buildPromptInput('draw a login', [])).toBe('draw a login');
  });

  it('becomes one user message: images first, then the words', async () => {
    const input = buildPromptInput('make it look like this', [
      { mediaType: 'image/png', base64: PNG_BASE64 },
    ]);
    expect(typeof input).not.toBe('string');

    const messages: unknown[] = [];
    for await (const message of input as AsyncIterable<unknown>) messages.push(message);
    expect(messages).toHaveLength(1);

    const content = (messages[0] as { message: { content: Array<Record<string, unknown>> } })
      .message.content;
    expect(content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: PNG_BASE64 },
    });
    expect(content[1]).toEqual({ type: 'text', text: 'make it look like this' });
  });
});
