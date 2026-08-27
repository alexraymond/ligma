/**
 * `store/memory.ts` — the cross-session agent memory store (OD-092).
 *
 * Points the whole data dir at a throwaway directory (the `LIGMA_DATA_DIR`
 * pattern skill-catalog-route.test.ts uses) so nothing here touches the real
 * `data/`, and writes a real daemon-config.json to drive the cap and the
 * on/off knob.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(path.join(tmpdir(), 'ligma-memory-store-'));
process.env.LIGMA_DATA_DIR = dataDir;

const { addMemory, deleteMemory, memorySection, readMemory, setMemoryPinned } = await import(
  '../src/store/memory'
);
const { invalidateConfigCache } = await import('../src/engine/config-cache');

function writeConfig(memory: { enabled: boolean; maxEntries: number }): void {
  writeFileSync(
    path.join(dataDir, 'daemon-config.json'),
    JSON.stringify({ execution: { memory } }, null, 2),
    'utf-8',
  );
  // mtime granularity is coarser than a test — force the reload.
  invalidateConfigCache();
}

beforeEach(async () => {
  await rm(path.join(dataDir, 'memory'), { recursive: true, force: true });
  writeConfig({ enabled: true, maxEntries: 50 });
});

describe('round trip', () => {
  it('an agent that never remembered anything has no memories', async () => {
    expect(await readMemory('agent_new')).toEqual({ entries: [] });
  });

  it('stores an added memory in data/memory/<agentId>.json and reads it back', async () => {
    const entry = await addMemory('agent_a', {
      text: '  the product repo uses pnpm  ',
      source: 'task_1',
    });

    expect(entry.id).toMatch(/^mem_/);
    expect(entry.text).toBe('the product repo uses pnpm');
    expect(entry.source).toBe('task_1');
    expect(entry.pinned).toBe(false);

    const onDisk = JSON.parse(
      await readFile(path.join(dataDir, 'memory', 'agent_a.json'), 'utf-8'),
    );
    expect(onDisk.entries).toHaveLength(1);
    expect((await readMemory('agent_a')).entries[0]).toEqual(entry);
  });

  it("keeps each agent's memories separate", async () => {
    await addMemory('agent_a', { text: 'a fact' });
    await addMemory('agent_b', { text: 'b fact' });
    expect((await readMemory('agent_a')).entries.map((e) => e.text)).toEqual(['a fact']);
    expect((await readMemory('agent_b')).entries.map((e) => e.text)).toEqual(['b fact']);
  });

  it('deletes one memory and reports an unknown id', async () => {
    const entry = await addMemory('agent_a', { text: 'temporary' });
    expect(await deleteMemory('agent_a', entry.id)).toBe(true);
    expect(await deleteMemory('agent_a', entry.id)).toBe(false);
    expect((await readMemory('agent_a')).entries).toEqual([]);
  });

  it('refuses an agent id that would escape the memory directory', async () => {
    await expect(addMemory('../../etc/passwd', { text: 'nope' })).rejects.toThrow(
      /Invalid agentId/,
    );
  });
});

describe('eviction', () => {
  it('drops the oldest once the cap is passed', async () => {
    writeConfig({ enabled: true, maxEntries: 3 });
    for (const text of ['one', 'two', 'three', 'four', 'five']) {
      await addMemory('agent_a', { text });
    }
    expect((await readMemory('agent_a')).entries.map((e) => e.text)).toEqual([
      'three',
      'four',
      'five',
    ]);
  });

  it('honours a cap lowered after the fact on the next write', async () => {
    writeConfig({ enabled: true, maxEntries: 5 });
    for (const text of ['one', 'two', 'three', 'four', 'five']) {
      await addMemory('agent_a', { text });
    }
    writeConfig({ enabled: true, maxEntries: 2 });
    await addMemory('agent_a', { text: 'six' });
    expect((await readMemory('agent_a')).entries.map((e) => e.text)).toEqual(['five', 'six']);
  });
});

describe('pins', () => {
  it('survives eviction while unpinned neighbours are dropped', async () => {
    writeConfig({ enabled: true, maxEntries: 3 });
    const first = await addMemory('agent_a', { text: 'one' });
    await setMemoryPinned('agent_a', first.id, true);
    for (const text of ['two', 'three', 'four', 'five']) {
      await addMemory('agent_a', { text });
    }

    const entries = (await readMemory('agent_a')).entries;
    expect(entries.map((e) => e.text)).toEqual(['one', 'four', 'five']);
    expect(entries[0].pinned).toBe(true);
  });

  it('lets the file exceed the cap rather than delete a pin', async () => {
    writeConfig({ enabled: true, maxEntries: 2 });
    for (const text of ['one', 'two', 'three']) {
      const entry = await addMemory('agent_a', { text });
      await setMemoryPinned('agent_a', entry.id, true);
    }
    expect((await readMemory('agent_a')).entries.map((e) => e.text)).toEqual([
      'one',
      'two',
      'three',
    ]);
  });

  it('re-applies the cap when a pin is released', async () => {
    writeConfig({ enabled: true, maxEntries: 2 });
    const first = await addMemory('agent_a', { text: 'one' });
    await setMemoryPinned('agent_a', first.id, true);
    await addMemory('agent_a', { text: 'two' });
    await addMemory('agent_a', { text: 'three' });
    expect((await readMemory('agent_a')).entries.map((e) => e.text)).toEqual(['one', 'three']);

    await setMemoryPinned('agent_a', first.id, false);
    expect((await readMemory('agent_a')).entries.map((e) => e.text)).toEqual(['one', 'three']);
  });

  it('returns null for an unknown entry', async () => {
    expect(await setMemoryPinned('agent_a', 'mem_nope', true)).toBeNull();
  });
});

describe('memorySection', () => {
  it('is empty for an agent with no memories', () => {
    expect(memorySection('agent_a')).toBe('');
  });

  it('renders one bullet per memory under the remembered-context heading', async () => {
    await addMemory('agent_a', { text: 'the product repo uses pnpm' });
    await addMemory('agent_a', { text: 'Alex wants British English' });

    const section = memorySection('agent_a');
    expect(section).toContain('## What you remember');
    expect(section).toContain('- the product repo uses pnpm');
    expect(section).toContain('- Alex wants British English');
    expect(section.indexOf('pnpm')).toBeLessThan(section.indexOf('British'));
  });

  it('flattens a multi-line memory so it cannot break the list', async () => {
    await addMemory('agent_a', { text: 'line one\n\n  line two' });
    expect(memorySection('agent_a')).toContain('- line one line two');
  });

  it('is empty when memory is switched off, without touching what is stored', async () => {
    await addMemory('agent_a', { text: 'still here' });
    writeConfig({ enabled: false, maxEntries: 50 });

    expect(memorySection('agent_a')).toBe('');
    expect((await readMemory('agent_a')).entries).toHaveLength(1);
  });
});
