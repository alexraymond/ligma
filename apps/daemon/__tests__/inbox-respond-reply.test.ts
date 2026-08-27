import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
/**
 * E10 (second half) — the inbox pass no longer hands a spawn a pen.
 *
 * It used to grant Edit/Write on `inbox.json` and instruct the model to append
 * its own message — a model whose entire prompt is somebody else's untrusted
 * message text, writing into the store that text came from. It now follows
 * `run-talk-respond.ts`: the spawn is read-only, returns a fenced JSON block,
 * and the daemon files the reply itself.
 *
 * Two things are pinned here: the grant, and the parse (including the salvage
 * path, because a CLI that ignores the shape still said something the human is
 * owed).
 */
import { afterAll, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-inbox-respond-'));
process.env.LIGMA_DATA_DIR = dataDir;

const { toolsForRole } = await import('../src/engine/config');
const { replyBodyFrom } = await import('../src/engine/run-inbox-respond');

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("the inbox role's tool grant", () => {
  it('is read-only — no Edit, no Write, no Bash', () => {
    expect(toolsForRole('inbox')).toEqual(['Read']);
  });

  it('matches talk, the other compose-only role', () => {
    expect(toolsForRole('inbox')).toEqual(toolsForRole('talk'));
  });
});

describe('replyBodyFrom', () => {
  it('takes the reply out of the fenced JSON block the prompt asks for', () => {
    const stdout = [
      'Here you go.',
      '```json',
      '{ "reply": "Shipped the fix — the null check is in the loader now." }',
      '```',
    ].join('\n');

    expect(replyBodyFrom(stdout)).toBe('Shipped the fix — the null check is in the loader now.');
  });

  it('reads the block out of a CLI result envelope', () => {
    const stdout = JSON.stringify({
      type: 'result',
      result: '```json\n{ "reply": "Looks fine to me." }\n```',
    });

    expect(replyBodyFrom(stdout)).toBe('Looks fine to me.');
  });

  it('falls back to the raw answer rather than filing silence', () => {
    const body = replyBodyFrom('I had a look and the migration is already applied.');
    expect(body).toContain('the migration is already applied');
  });

  it('falls back when the block is there but the reply is empty', () => {
    const stdout = ['```json', '{ "reply": "   " }', '```'].join('\n');
    // Salvage keeps whatever the model actually emitted — never an empty body.
    expect(replyBodyFrom(stdout).length).toBeGreaterThan(0);
  });
});
