/**
 * `data/memory/<agentId>.json` — what an agent is told it remembers across
 * sessions (OD-092).
 *
 * A memory is a short note that outlives one run: "the product repo uses pnpm,
 * not npm", "Alex wants copy in British English". The prompt builder injects
 * them as a `## What you remember` section, so an agent dispatched tomorrow
 * starts where yesterday's left off instead of re-learning the same fact.
 *
 * WRITES ARE EXPLICIT. Something (a human in Settings, later an automation)
 * decides a fact is worth keeping and POSTs it. Nothing here reads a transcript
 * and guesses: pattern-matching a model's prose for structured data is banned in
 * this repo, and the honest version of automatic capture is a model emitting
 * `{text, source}` itself. Non-goal for now — see the note on `memorySection`.
 *
 * Layout follows `routes/references/store.ts`: one JSON file per owner, a
 * per-file mutex, write-then-rename. No index file — the agent id IS the key,
 * and the only listing anyone needs is "this agent's memories".
 */

import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Mutex } from 'async-mutex';
import { cachedConfig } from '../engine/config-cache';
import { DATA_DIR } from '../paths';
import { assertSafeId } from '../studio/paths';
import { generateId } from './ids';

export interface MemoryEntry {
  id: string;
  text: string;
  /** Where it came from: a taskId, a runId, or null when a human typed it. */
  source: string | null;
  createdAt: string;
  /** A pin survives eviction — the cap yields to it, never the other way round. */
  pinned: boolean;
}

export interface MemoryFile {
  entries: MemoryEntry[];
}

const MEMORY_DIR = path.join(DATA_DIR, 'memory');

function memoryPath(agentId: string): string {
  return path.join(MEMORY_DIR, `${assertSafeId('agentId', agentId)}.json`);
}

/** `execution.memory` with the daemon's defaults applied (see engine/config.ts). */
function memoryConfig(): { enabled: boolean; maxEntries: number } {
  return cachedConfig().execution.memory;
}

function parse(raw: string): MemoryFile {
  const data = JSON.parse(raw) as Partial<MemoryFile>;
  return { entries: Array.isArray(data.entries) ? data.entries : [] };
}

/** An agent that has never remembered anything gets the empty shape, not an error. */
export async function readMemory(agentId: string): Promise<MemoryFile> {
  try {
    return parse(await readFile(memoryPath(agentId), 'utf-8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { entries: [] };
    throw err;
  }
}

async function writeMemory(agentId: string, data: MemoryFile): Promise<void> {
  const file = memoryPath(agentId);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await rename(tmp, file);
}

const locks = new Map<string, Mutex>();

function lockFor(agentId: string): Mutex {
  let mutex = locks.get(agentId);
  if (!mutex) {
    mutex = new Mutex();
    locks.set(agentId, mutex);
  }
  return mutex;
}

/** Read-modify-write under this agent's mutex. `fn` mutates `data` in place. */
async function mutate<T>(agentId: string, fn: (data: MemoryFile) => T): Promise<T> {
  return lockFor(agentId).runExclusive(async () => {
    const data = await readMemory(agentId);
    const result = fn(data);
    await writeMemory(agentId, data);
    return result;
  });
}

/**
 * Drop oldest-first until the cap holds, skipping pinned entries.
 *
 * `entries` is append-ordered, so index 0 is the oldest. If everything left is
 * pinned the file is allowed to exceed the cap: a pin is the user saying "keep
 * this", and silently deleting it to honour a number would be the worse bug.
 */
function evict(entries: MemoryEntry[], maxEntries: number): void {
  while (entries.length > maxEntries) {
    const oldestUnpinned = entries.findIndex((e) => !e.pinned);
    if (oldestUnpinned === -1) return;
    entries.splice(oldestUnpinned, 1);
  }
}

export async function addMemory(
  agentId: string,
  input: { text: string; source?: string | null; pinned?: boolean },
): Promise<MemoryEntry> {
  const entry: MemoryEntry = {
    id: generateId('mem'),
    text: input.text.trim(),
    source: input.source ?? null,
    createdAt: new Date().toISOString(),
    pinned: input.pinned ?? false,
  };
  return mutate(agentId, (data) => {
    // Make room BEFORE appending, so the memory just asked for is never the one
    // evicted. Appending first and then evicting would silently discard this
    // write whenever every older entry is pinned — a write that vanishes is
    // worse than a file one entry over its cap.
    evict(data.entries, Math.max(memoryConfig().maxEntries - 1, 0));
    data.entries.push(entry);
    return entry;
  });
}

/** Pin or unpin one entry. Null when this agent has no such entry. */
export async function setMemoryPinned(
  agentId: string,
  entryId: string,
  pinned: boolean,
): Promise<MemoryEntry | null> {
  return mutate(agentId, (data) => {
    const entry = data.entries.find((e) => e.id === entryId);
    if (!entry) return null;
    entry.pinned = pinned;
    // Unpinning can put the file back over the cap it was allowed to exceed.
    evict(data.entries, memoryConfig().maxEntries);
    return entry;
  });
}

/** False when this agent has no such entry. */
export async function deleteMemory(agentId: string, entryId: string): Promise<boolean> {
  return mutate(agentId, (data) => {
    const before = data.entries.length;
    data.entries = data.entries.filter((e) => e.id !== entryId);
    return data.entries.length !== before;
  });
}

/**
 * The `## What you remember` block for this agent's prompt, or `""` when memory
 * is off, unreadable, or empty. Sync because the prompt builder is
 * (`readFileSync` throughout), and pure in the sense that matters: same file and
 * same config in, same string out, nothing written.
 *
 * Framed as context rather than instruction on purpose. These notes were true
 * once; the task in front of the agent is true now, and the agent is told which
 * wins. Automatic capture — a model handing back `{text, source}` after a run —
 * would write through `addMemory` and change nothing here.
 */
export function memorySection(agentId: string): string {
  if (!memoryConfig().enabled) return '';

  let entries: MemoryEntry[];
  try {
    entries = parse(readFileSync(memoryPath(agentId), 'utf-8')).entries;
  } catch {
    return '';
  }
  if (entries.length === 0) return '';

  return [
    '## What you remember',
    '',
    'Notes kept from your earlier sessions. They are context, not orders — where one',
    'contradicts the task below, the task wins.',
    '',
    // Flattened to one line each so a multi-line note cannot break the list it
    // is rendered into. This is formatting, not parsing.
    ...entries.map((e) => `- ${e.text.replace(/\s+/g, ' ').trim()}`),
  ].join('\n');
}
