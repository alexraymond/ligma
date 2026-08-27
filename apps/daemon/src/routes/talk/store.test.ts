import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dataDir: string;
let previousData: string | undefined;

function projectDir(projectId: string): string {
  return path.join(dataDir, 'projects', projectId);
}

function seedTalkFile(projectId: string, contents: string): void {
  mkdirSync(projectDir(projectId), { recursive: true });
  writeFileSync(path.join(projectDir(projectId), 'talk.json'), contents, 'utf-8');
}

beforeEach(() => {
  previousData = process.env.LIGMA_DATA_DIR;
  dataDir = mkdtempSync(path.join(tmpdir(), 'ligma-talk-store-'));
  process.env.LIGMA_DATA_DIR = dataDir;
  vi.resetModules();
});

afterEach(() => {
  if (previousData === undefined) delete process.env.LIGMA_DATA_DIR;
  else process.env.LIGMA_DATA_DIR = previousData;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('talk store', () => {
  it('gives an untouched project the empty thread, not an error', async () => {
    const { readTalk } = await import('./store');
    expect(await readTalk('proj_a')).toEqual({ messages: [] });
  });

  it('appends messages in order and stamps id + createdAt', async () => {
    const { appendTalkMessage, readTalk } = await import('./store');
    const first = await appendTalkMessage('proj_a', { author: 'you', body: 'hello' });
    await appendTalkMessage('proj_a', { author: 'system', body: 'hi back' });

    expect(first.id).toMatch(/^talk_/);
    expect(Date.parse(first.createdAt)).not.toBeNaN();
    const { messages } = await readTalk('proj_a');
    expect(messages.map((m) => [m.author, m.body])).toEqual([
      ['you', 'hello'],
      ['system', 'hi back'],
    ]);
  });

  it('omits `chips` entirely when there are none, rather than writing []', async () => {
    const { appendTalkMessage } = await import('./store');
    const bare = await appendTalkMessage('proj_a', { author: 'system', body: 'no citations' });
    const withChips = await appendTalkMessage('proj_a', {
      author: 'system',
      body: 'one citation',
      chips: [{ kind: 'task', id: 'task_1' }],
    });
    expect('chips' in bare).toBe(false);
    expect(withChips.chips).toEqual([{ kind: 'task', id: 'task_1' }]);
  });

  it('keeps threads separate per project', async () => {
    const { appendTalkMessage, readTalk } = await import('./store');
    await appendTalkMessage('proj_a', { author: 'you', body: 'a' });
    await appendTalkMessage('proj_b', { author: 'you', body: 'b' });
    expect((await readTalk('proj_a')).messages).toHaveLength(1);
    expect((await readTalk('proj_b')).messages.map((m) => m.body)).toEqual(['b']);
  });

  it('survives a corrupt file: quarantines it, keeps the drawer usable', async () => {
    seedTalkFile('proj_a', '{ this is not json');
    const { readTalk, appendTalkMessage } = await import('./store');

    expect(await readTalk('proj_a')).toEqual({ messages: [] });
    // The bad bytes are kept aside, not silently overwritten by the next append.
    expect(readdirSync(projectDir('proj_a')).some((f) => f.startsWith('talk.json.corrupt-'))).toBe(
      true,
    );

    await appendTalkMessage('proj_a', { author: 'you', body: 'still works' });
    expect((await readTalk('proj_a')).messages.map((m) => m.body)).toEqual(['still works']);
  });

  it('treats a well-formed file with no messages array as corrupt', async () => {
    seedTalkFile('proj_a', JSON.stringify({ notes: [] }));
    const { readTalk } = await import('./store');
    expect(await readTalk('proj_a')).toEqual({ messages: [] });
  });

  it('refuses to grow past the cap', async () => {
    const { MAX_TALK_MESSAGES, appendTalkMessage } = await import('./store');
    seedTalkFile(
      'proj_a',
      JSON.stringify({
        messages: Array.from({ length: MAX_TALK_MESSAGES }, (_, i) => ({
          id: `talk_${i}`,
          author: 'you',
          body: 'x',
          createdAt: new Date().toISOString(),
        })),
      }),
    );
    await expect(
      appendTalkMessage('proj_a', { author: 'you', body: 'one too many' }),
    ).rejects.toThrow(/already has 2000 messages/);
  });

  it('refuses a project id that could escape the projects dir', async () => {
    const { readTalk } = await import('./store');
    await expect(readTalk('../../etc')).rejects.toThrow(/Invalid projectId/);
  });
});
