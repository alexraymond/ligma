import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { NOOP_LOGGER } from './logger.js';
import { SessionReader } from './reader.js';
import { SessionWriter } from './writer.js';

let rootDir: string;
const sessionId = 'sess-read';

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), 'session-reader-'));
});

async function seed(count: number): Promise<string[]> {
  const writer = new SessionWriter({
    sessionId,
    logger: NOOP_LOGGER,
    paths: { rootDir },
  });
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const r = await writer.append({
      type: 'turn_done',
      turnId: `t-${i}`,
      outcome: 'ok',
    });
    ids.push(r.id);
  }
  return ids;
}

function reader() {
  return new SessionReader({
    sessionId,
    logger: NOOP_LOGGER,
    paths: { rootDir },
  });
}

describe('SessionReader', () => {
  it('fetchLatest returns newest-first, capped at limit', async () => {
    const ids = await seed(10);
    const page = await reader().fetchLatest(3);
    expect(page.entries).toHaveLength(3);
    expect(page.entries.map((e) => e.id)).toEqual([ids[9], ids[8], ids[7]]);
    expect(page.hasMore).toBe(true);
    expect(page.firstId).toBe(ids[7]);
  });

  it('fetchLatest with limit >= total returns everything and hasMore=false', async () => {
    const ids = await seed(5);
    const page = await reader().fetchLatest(10);
    expect(page.entries.map((e) => e.id)).toEqual([...ids].reverse());
    expect(page.hasMore).toBe(false);
  });

  it('fetchOlder returns the next page back in time, non-overlapping', async () => {
    const ids = await seed(10);
    const first = await reader().fetchLatest(3);
    const firstIds = first.entries.map((e) => e.id);

    if (first.firstId === null) throw new Error('expected first.firstId to be set');
    const next = await reader().fetchOlder(first.firstId, 3);
    const nextIds = next.entries.map((e) => e.id);

    // No overlap with the first page.
    for (const id of nextIds) expect(firstIds).not.toContain(id);

    // Walking back by 3 from ids[7] should yield ids[6], ids[5], ids[4].
    expect(nextIds).toEqual([ids[6], ids[5], ids[4]]);
    expect(next.hasMore).toBe(true);
  });

  it('paginating all the way back consumes every entry exactly once', async () => {
    const total = 11;
    const ids = await seed(total);
    const limit = 4;
    const seen: string[] = [];

    let page = await reader().fetchLatest(limit);
    seen.push(...page.entries.map((e) => e.id));
    while (page.hasMore && page.firstId !== null) {
      page = await reader().fetchOlder(page.firstId, limit);
      seen.push(...page.entries.map((e) => e.id));
    }
    expect(seen).toHaveLength(total);
    // No duplicates.
    expect(new Set(seen).size).toBe(total);
    // Matches the reverse of the insertion order.
    expect(seen).toEqual([...ids].reverse());
  });

  it('empty cursor (walked off the start) returns an empty page with hasMore=false', async () => {
    const ids = await seed(3);
    const oldest = ids[0];
    if (oldest === undefined) throw new Error('seed returned no ids');
    // oldest is the first id — requesting older than it should yield nothing.
    const page = await reader().fetchOlder(oldest, 5);
    expect(page.entries).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.firstId).toBeNull();
  });

  it('unknown cursor returns an empty page', async () => {
    await seed(3);
    const page = await reader().fetchOlder('00000000-0000-0000-0000-000000000000', 5);
    expect(page.entries).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it('missing session file returns an empty page (not an error)', async () => {
    // No seed — directory doesn't even exist.
    const page = await reader().fetchLatest(5);
    expect(page.entries).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it('rejects non-positive limits', async () => {
    await seed(1);
    await expect(reader().fetchLatest(0)).rejects.toThrow();
    await expect(reader().fetchLatest(-1)).rejects.toThrow();
  });
});
