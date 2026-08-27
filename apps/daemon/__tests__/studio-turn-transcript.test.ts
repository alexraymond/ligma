import { mkdtempSync } from 'node:fs';
import { appendFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { DesignTranscriptEntry } from '@ligma/api';
/**
 * The turn transcript: what the composer column reads back after a reload, and
 * what the SSE lane carries while the turn is still running.
 *
 * Two properties have to hold together, which is why they are tested together:
 * every entry the recorder persists is also emitted as a frame, and every
 * entry read back is byte-identical to the one written. A transcript that
 * streams one thing and reloads another is worse than no transcript.
 */
import { afterAll, describe, expect, it } from 'vitest';

// Set before anything resolves `src/paths`, same seam `studio-snapshots.test.ts` uses.
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ligma-turn-transcript-'));
process.env.LIGMA_DATA_DIR = dataDir;

const {
  appendTranscriptEntry,
  readTurnTranscript,
  transcriptFilePath,
  TRANSCRIPT_PART_LIMIT,
  createTurnRecorder,
} = await import('../src/studio/turn-transcript');
const { subscribeStudio, resetStudioChannel } = await import('../src/studio/events');

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

const projectId = 'test_turn_transcript';

function entry(overrides: Partial<DesignTranscriptEntry> = {}): DesignTranscriptEntry {
  return {
    designId: 'd1',
    turnId: 'dt_1',
    role: 'designer',
    at: '2026-08-26T10:00:00.000Z',
    part: { kind: 'text', text: 'hello', truncated: false },
    ...overrides,
  };
}

describe('turn transcript persistence', () => {
  it('reads back every appended entry, in order, identical to what was written', async () => {
    const entries: DesignTranscriptEntry[] = [
      entry({
        role: 'user',
        part: { kind: 'text', text: 'a hello-world landing page', truncated: false },
      }),
      entry({ part: { kind: 'thinking', text: 'one screen, centred', truncated: false } }),
      entry({
        part: {
          kind: 'tool',
          toolUseId: 't1',
          toolName: 'write_file',
          summary: 'index.html',
          status: 'running',
        },
      }),
      entry({
        part: {
          kind: 'tool',
          toolUseId: 't1',
          toolName: 'write_file',
          summary: 'index.html',
          status: 'ok',
        },
      }),
      entry({ part: { kind: 'files', paths: ['index.html'] } }),
      entry({ part: { kind: 'done', stopReason: 'stop', error: null } }),
    ];
    for (const one of entries) await appendTranscriptEntry(projectId, 'd1', one);

    expect(await readTurnTranscript(projectId, 'd1')).toEqual(entries);
  });

  it('returns an empty list for a design that has never had a turn', async () => {
    expect(await readTurnTranscript(projectId, 'no-such-design')).toEqual([]);
  });

  it('skips a corrupt line rather than losing the whole transcript', async () => {
    await appendTranscriptEntry(projectId, 'd-corrupt', entry({ designId: 'd-corrupt' }));
    await appendFile(transcriptFilePath(projectId, 'd-corrupt'), '{ not json\n', 'utf-8');
    await appendTranscriptEntry(
      projectId,
      'd-corrupt',
      entry({ designId: 'd-corrupt', part: { kind: 'done', stopReason: 'stop', error: null } }),
    );

    const read = await readTurnTranscript(projectId, 'd-corrupt');
    expect(read).toHaveLength(2);
    expect(read[1]!.part).toEqual({ kind: 'done', stopReason: 'stop', error: null });
  });

  it('caps an oversized part and says so, rather than storing a whole thinking dump', async () => {
    const huge = 'x'.repeat(TRANSCRIPT_PART_LIMIT * 3);
    await appendTranscriptEntry(
      projectId,
      'd-cap',
      entry({ designId: 'd-cap', part: { kind: 'thinking', text: huge, truncated: false } }),
    );

    const [only] = await readTurnTranscript(projectId, 'd-cap');
    expect(only!.part.kind).toBe('thinking');
    const part = only!.part as { text: string; truncated: boolean };
    expect(part.text.length).toBeLessThanOrEqual(TRANSCRIPT_PART_LIMIT + 1);
    expect(part.truncated).toBe(true);
  });

  it('caps a tool summary to one line', async () => {
    await appendTranscriptEntry(
      projectId,
      'd-cap2',
      entry({
        designId: 'd-cap2',
        part: {
          kind: 'tool',
          toolUseId: 't9',
          toolName: 'write_file',
          summary: `${'p'.repeat(400)}\nsecond line`,
          status: 'ok',
        },
      }),
    );
    const [only] = await readTurnTranscript(projectId, 'd-cap2');
    const summary = (only!.part as { summary: string }).summary;
    expect(summary).not.toContain('\n');
    expect(summary.length).toBeLessThanOrEqual(121);
  });
});

describe('the recorder forwards every entry it persists', () => {
  it('emits one SSE frame per appended entry and coalesces prose into readable blocks', async () => {
    const designId = 'd-live';
    resetStudioChannel(designId);
    const frames: Array<{ event: string; data: unknown }> = [];
    const unsubscribe = subscribeStudio(designId, (frame) =>
      frames.push({ event: frame.event, data: frame.data }),
    );

    const recorder = createTurnRecorder(projectId, designId, 'dt_live');
    await recorder.user('draw me a landing page');
    // Many small deltas — the ring buffer that carries file progress is 256
    // frames deep, so these must not each become a frame.
    for (let i = 0; i < 40; i += 1) recorder.text('chunk ');
    recorder.toolStart('t1', 'write_file', { path: 'index.html' });
    recorder.toolEnd('t1', 'write_file', { path: 'index.html' }, true);
    await recorder.finish('stop', null, ['index.html']);
    unsubscribe();

    const transcriptFrames = frames.filter((f) => f.event === 'design.transcript');
    const parts = transcriptFrames.map((f) => (f.data as DesignTranscriptEntry).part);

    // The user prompt opens the transcript, on its own message.
    expect((transcriptFrames[0]!.data as DesignTranscriptEntry).role).toBe('user');
    // Prose is coalesced: far fewer frames than the 40 deltas that produced it.
    const prose = transcriptFrames
      .map((f) => f.data as DesignTranscriptEntry)
      .filter((e) => e.role === 'designer' && e.part.kind === 'text');
    expect(prose.length).toBeLessThan(10);
    expect(prose.map((e) => (e.part as { text: string }).text).join('')).toBe('chunk '.repeat(40));
    // The tool card lands twice: running, then resolved.
    expect(
      parts.filter((p) => p.kind === 'tool').map((p) => (p as { status: string }).status),
    ).toEqual(['running', 'ok']);
    expect(parts.filter((p) => p.kind === 'files')).toEqual([
      { kind: 'files', paths: ['index.html'] },
    ]);
    expect(parts.at(-1)).toEqual({ kind: 'done', stopReason: 'stop', error: null });

    // Everything that was emitted was also persisted — same entries, same order.
    const persisted = await readTurnTranscript(projectId, designId);
    expect(persisted).toEqual(transcriptFrames.map((f) => f.data));
  });

  it('splits an oversized prose block instead of truncating it, but caps thinking', async () => {
    const designId = 'd-split';
    resetStudioChannel(designId);
    const recorder = createTurnRecorder(projectId, designId, 'dt_split');
    const long = 'p'.repeat(TRANSCRIPT_PART_LIMIT * 2 + 100);
    recorder.text(long);
    recorder.thinking('t'.repeat(TRANSCRIPT_PART_LIMIT * 2));
    await recorder.finish('stop', null, []);

    const entries = await readTurnTranscript(projectId, designId);
    const prose = entries.filter((e) => e.part.kind === 'text');
    expect(prose).toHaveLength(3);
    // Nothing lost: the pieces reassemble into exactly what was said.
    expect(prose.map((e) => (e.part as { text: string }).text).join('')).toBe(long);

    const thought = entries.find((e) => e.part.kind === 'thinking')?.part as {
      text: string;
      truncated: boolean;
    };
    expect(thought.truncated).toBe(true);
    expect(thought.text.length).toBe(TRANSCRIPT_PART_LIMIT + 1);
  });

  it('flushes buffered prose before a tool card so the order stays truthful', async () => {
    const designId = 'd-order';
    resetStudioChannel(designId);
    const recorder = createTurnRecorder(projectId, designId, 'dt_order');
    recorder.text('Writing the screen.');
    recorder.toolStart('t1', 'write_file', { path: 'index.html' });
    await recorder.finish('stop', null, []);

    const kinds = (await readTurnTranscript(projectId, designId)).map((e) => e.part.kind);
    expect(kinds).toEqual(['text', 'tool', 'done']);
  });
});
