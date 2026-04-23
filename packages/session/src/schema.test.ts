import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CustomTitle,
  FileHistorySnapshot,
  SCHEMA_VERSION,
  SessionEntry,
  ToolUseSummary,
  TranscriptMessage,
  TurnDone,
} from './schema.js';

const baseFields = () => ({
  schemaVersion: SCHEMA_VERSION,
  id: randomUUID(),
  sessionId: 'sess-1',
  timestamp: new Date().toISOString(),
});

describe('schema', () => {
  it('parses a TranscriptMessage', () => {
    const entry = TranscriptMessage.parse({
      ...baseFields(),
      type: 'transcript',
      role: 'assistant',
      payload: { text: 'hi' },
    });
    expect(entry.role).toBe('assistant');
  });

  it('parses a FileHistorySnapshot', () => {
    const entry = FileHistorySnapshot.parse({
      ...baseFields(),
      type: 'file_history_snapshot',
      path: 'index.html',
      fingerprint: 'deadbeef',
      byteSize: 42,
    });
    expect(entry.fingerprint).toBe('deadbeef');
  });

  it('parses a CustomTitle', () => {
    const entry = CustomTitle.parse({
      ...baseFields(),
      type: 'custom_title',
      title: 'My design run',
    });
    expect(entry.title).toBe('My design run');
  });

  it('parses a ToolUseSummary', () => {
    const entry = ToolUseSummary.parse({
      ...baseFields(),
      type: 'tool_use_summary',
      toolName: 'fs-write',
      toolCallId: 'tc-1',
      inputPreview: '{...}',
      outcome: 'ok',
      durationMs: 12,
    });
    expect(entry.toolName).toBe('fs-write');
  });

  it('parses a TurnDone', () => {
    const entry = TurnDone.parse({
      ...baseFields(),
      type: 'turn_done',
      turnId: 'turn-1',
      outcome: 'ok',
    });
    expect(entry.outcome).toBe('ok');
  });

  it('discriminated union picks the right shape by `type`', () => {
    const variants = [
      { ...baseFields(), type: 'custom_title' as const, title: 't' },
      { ...baseFields(), type: 'turn_done' as const, turnId: 'x', outcome: 'ok' },
    ];
    for (const v of variants) {
      const parsed = SessionEntry.parse(v);
      expect(parsed.type).toBe(v.type);
    }
  });

  it('rejects an entry without schemaVersion', () => {
    expect(() =>
      SessionEntry.parse({
        id: randomUUID(),
        sessionId: 'sess-1',
        timestamp: new Date().toISOString(),
        type: 'turn_done',
        turnId: 't',
        outcome: 'ok',
      }),
    ).toThrow();
  });
});
