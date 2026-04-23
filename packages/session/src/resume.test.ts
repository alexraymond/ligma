import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NOOP_LOGGER } from './logger.js';
import { resumeSession } from './resume.js';
import { SessionWriter } from './writer.js';

let rootDir: string;
const sessionId = 'sess-resume';

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), 'session-resume-'));
});

function transcriptPath(): string {
  return join(rootDir, 'sessions', sessionId, 'transcript.jsonl');
}

describe('resumeSession', () => {
  it('replays entries in forward order', async () => {
    const writer = new SessionWriter({
      sessionId,
      logger: NOOP_LOGGER,
      paths: { rootDir },
    });
    await writer.append({ type: 'custom_title', title: 'first' });
    await writer.append({
      type: 'transcript',
      role: 'user',
      payload: { text: 'hello' },
    });
    await writer.append({ type: 'turn_done', turnId: 't1', outcome: 'ok' });

    const resumed = await resumeSession({
      sessionId,
      logger: NOOP_LOGGER,
      paths: { rootDir },
    });
    expect(resumed.entryCount).toBe(3);
    expect(resumed.title).toBe('first');
    expect(resumed.transcript).toHaveLength(1);
    expect(resumed.turns).toHaveLength(1);
  });

  it('applies last-wins rules for CustomTitle', async () => {
    const writer = new SessionWriter({
      sessionId,
      logger: NOOP_LOGGER,
      paths: { rootDir },
    });
    await writer.append({ type: 'custom_title', title: 'first' });
    await writer.append({ type: 'custom_title', title: 'second' });
    await writer.append({ type: 'custom_title', title: 'third' });

    const resumed = await resumeSession({
      sessionId,
      logger: NOOP_LOGGER,
      paths: { rootDir },
    });
    expect(resumed.title).toBe('third');
  });

  it('applies last-wins rules for FileHistorySnapshot per path', async () => {
    const writer = new SessionWriter({
      sessionId,
      logger: NOOP_LOGGER,
      paths: { rootDir },
    });
    await writer.append(
      { type: 'file_history_snapshot', path: 'a.html', byteSize: 1 },
      { fileBody: 'v1' },
    );
    await writer.append(
      { type: 'file_history_snapshot', path: 'a.html', byteSize: 1 },
      { fileBody: 'v2' },
    );
    await writer.append(
      { type: 'file_history_snapshot', path: 'b.html', byteSize: 1 },
      { fileBody: 'x' },
    );

    const resumed = await resumeSession({
      sessionId,
      logger: NOOP_LOGGER,
      paths: { rootDir },
    });
    expect(resumed.fileSnapshots.size).toBe(2);
    // Last snapshot for a.html was v2 — the v1 snapshot is shadowed.
    const aSnap = resumed.fileSnapshots.get('a.html');
    expect(aSnap?.byteSize).toBe(2);
    // Different content → different fingerprint than b.html's 'x' body.
    const bSnap = resumed.fileSnapshots.get('b.html');
    expect(aSnap?.fingerprint).not.toBe(bSnap?.fingerprint);
  });

  it('drops a truncated last line and logs a warning', async () => {
    // Pre-seed the transcript manually so we can craft a truncated tail.
    mkdirSync(join(rootDir, 'sessions', sessionId, 'files'), { recursive: true });
    const good1 = JSON.stringify({
      schemaVersion: 1,
      id: '11111111-1111-1111-1111-111111111111',
      sessionId,
      timestamp: '2026-01-01T00:00:00.000Z',
      type: 'custom_title',
      title: 'good-1',
    });
    const good2 = JSON.stringify({
      schemaVersion: 1,
      id: '22222222-2222-2222-2222-222222222222',
      sessionId,
      timestamp: '2026-01-01T00:00:01.000Z',
      type: 'turn_done',
      turnId: 't1',
      outcome: 'ok',
    });
    // Truncated tail: missing closing brace — JSON.parse will throw.
    const truncated = '{"schemaVersion":1,"id":"33333333-3333-3333-3333-333333333333","sessi';

    writeFileSync(transcriptPath(), `${good1}\n${good2}\n${truncated}`);

    const warn = vi.fn();
    const resumed = await resumeSession({
      sessionId,
      logger: { info: () => {}, warn, error: () => {} },
      paths: { rootDir },
    });
    expect(resumed.entryCount).toBe(2);
    expect(resumed.title).toBe('good-1');
    expect(resumed.turns).toHaveLength(1);

    // Warning was logged with the expected shape.
    const logged = warn.mock.calls.find((c) => c[0] === 'session.reader.truncated_last_line');
    expect(logged).toBeDefined();
  });

  it('resume continues after corrupt mid-stream entries, logging a warning', async () => {
    mkdirSync(join(rootDir, 'sessions', sessionId, 'files'), { recursive: true });
    const good1 = JSON.stringify({
      schemaVersion: 1,
      id: '11111111-1111-1111-1111-111111111111',
      sessionId,
      timestamp: '2026-01-01T00:00:00.000Z',
      type: 'custom_title',
      title: 'good-1',
    });
    const corrupt = 'not even close to json';
    const good2 = JSON.stringify({
      schemaVersion: 1,
      id: '22222222-2222-2222-2222-222222222222',
      sessionId,
      timestamp: '2026-01-01T00:00:01.000Z',
      type: 'turn_done',
      turnId: 't1',
      outcome: 'ok',
    });
    writeFileSync(transcriptPath(), `${good1}\n${corrupt}\n${good2}\n`);

    const warn = vi.fn();
    const resumed = await resumeSession({
      sessionId,
      logger: { info: () => {}, warn, error: () => {} },
      paths: { rootDir },
    });
    expect(resumed.entryCount).toBe(2);
    expect(warn.mock.calls.some((c) => c[0] === 'session.reader.corrupt_entry')).toBe(true);
  });

  it('returns an empty session when no transcript exists', async () => {
    const resumed = await resumeSession({
      sessionId,
      logger: NOOP_LOGGER,
      paths: { rootDir },
    });
    expect(resumed.entryCount).toBe(0);
    expect(resumed.title).toBeUndefined();
  });

  it('resumes successfully when a snapshot entry is followed by a partial write', async () => {
    // Combined scenario: user wrote 1 title + 1 turn, then the process died
    // mid-append. The reader drops the truncated tail; resume completes.
    mkdirSync(join(rootDir, 'sessions', sessionId, 'files'), { recursive: true });
    const t1 = JSON.stringify({
      schemaVersion: 1,
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      sessionId,
      timestamp: '2026-01-01T00:00:00.000Z',
      type: 'custom_title',
      title: 'finished',
    });
    const t2 = JSON.stringify({
      schemaVersion: 1,
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      sessionId,
      timestamp: '2026-01-01T00:00:01.000Z',
      type: 'turn_done',
      turnId: 'turn-a',
      outcome: 'ok',
    });
    writeFileSync(transcriptPath(), `${t1}\n${t2}\n`);
    // Simulate a crash mid-append of the next entry.
    appendFileSync(transcriptPath(), '{"schemaVersion":1,"id":"ccc');

    const warn = vi.fn();
    const resumed = await resumeSession({
      sessionId,
      logger: { info: () => {}, warn, error: () => {} },
      paths: { rootDir },
    });
    expect(resumed.title).toBe('finished');
    expect(resumed.turns).toHaveLength(1);
    expect(warn.mock.calls.some((c) => c[0] === 'session.reader.truncated_last_line')).toBe(true);
  });
});
