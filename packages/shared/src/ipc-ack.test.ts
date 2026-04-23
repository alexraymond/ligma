import { describe, expect, it } from 'vitest';
import {
  FS_UPDATED_ACK_SCHEMA_VERSION,
  type FsUpdatedAckV1,
  type FsUpdatedV1,
  isFsUpdatedAckV1,
} from './ipc-ack';

describe('FsUpdated ACK contract', () => {
  it('exports the schema-version literal', () => {
    expect(FS_UPDATED_ACK_SCHEMA_VERSION).toBe(1);
  });

  it('FsUpdatedV1 shape is { schemaVersion: 1, seq: number }', () => {
    const ev: FsUpdatedV1 = { schemaVersion: 1, seq: 42 };
    expect(ev.schemaVersion).toBe(1);
    expect(ev.seq).toBe(42);
  });

  it('FsUpdatedAckV1 shape is { schemaVersion: 1, seq: number }', () => {
    const ack: FsUpdatedAckV1 = { schemaVersion: 1, seq: 42 };
    expect(ack.schemaVersion).toBe(1);
    expect(ack.seq).toBe(42);
  });
});

describe('isFsUpdatedAckV1', () => {
  it('returns true for a well-formed ack', () => {
    expect(isFsUpdatedAckV1({ schemaVersion: 1, seq: 0 })).toBe(true);
    expect(isFsUpdatedAckV1({ schemaVersion: 1, seq: 7 })).toBe(true);
  });

  it('rejects wrong schema version', () => {
    expect(isFsUpdatedAckV1({ schemaVersion: 2, seq: 0 })).toBe(false);
    expect(isFsUpdatedAckV1({ schemaVersion: '1', seq: 0 })).toBe(false);
  });

  it('rejects missing or non-integer seq', () => {
    expect(isFsUpdatedAckV1({ schemaVersion: 1 })).toBe(false);
    expect(isFsUpdatedAckV1({ schemaVersion: 1, seq: 1.5 })).toBe(false);
    expect(isFsUpdatedAckV1({ schemaVersion: 1, seq: -1 })).toBe(false);
    expect(isFsUpdatedAckV1({ schemaVersion: 1, seq: '0' })).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(isFsUpdatedAckV1(null)).toBe(false);
    expect(isFsUpdatedAckV1(undefined)).toBe(false);
    expect(isFsUpdatedAckV1('ack')).toBe(false);
    expect(isFsUpdatedAckV1(42)).toBe(false);
  });
});
