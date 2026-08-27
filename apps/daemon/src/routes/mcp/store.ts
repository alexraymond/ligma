/**
 * JSON-file-backed registry of external MCP servers ligma's agents may use
 * (OD-101) — `data/mcp-servers.json`.
 *
 * Mirrors store/data.ts's mutex-protected read-modify-write convention
 * (mutateX(fn) locks, reads, lets fn mutate in place, writes, unlocks) without
 * touching that shared file — this feature's file ownership is `routes/mcp/**`
 * only, so the store lives here instead of growing the central one.
 *
 * Registration only. Nothing in this module spawns a process or attaches a
 * server to an agent run — wiring a registered server into an actual agent
 * spawn is a runner concern and stays out of scope (see routes/mcp/servers).
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Mutex } from 'async-mutex';
import { DATA_DIR } from '../../paths';

export type McpTransport = 'stdio' | 'http';

export interface McpServerEntry {
  id: string;
  name: string;
  transport: McpTransport;
  command: string | null;
  args: string[];
  url: string | null;
  enabled: boolean;
  createdAt: string;
}

export interface McpServersFile {
  servers: McpServerEntry[];
}

const FILE_PATH = path.join(DATA_DIR, 'mcp-servers.json');
const mutex = new Mutex();

async function read(): Promise<McpServersFile> {
  try {
    const raw = await readFile(FILE_PATH, 'utf-8');
    return JSON.parse(raw) as McpServersFile;
  } catch {
    // No file yet — an empty registry, not a crash (mirrors getAgents/getSkillsLibrary).
    return { servers: [] };
  }
}

async function write(data: McpServersFile): Promise<void> {
  await writeFile(FILE_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

export async function getMcpServers(): Promise<McpServersFile> {
  return read();
}

/** Atomic read-modify-write, same shape as store/data.ts's mutateX helpers. */
export async function mutateMcpServers<T>(
  fn: (data: McpServersFile) => Promise<T> | T,
): Promise<T> {
  return mutex.runExclusive(async () => {
    const data = await read();
    const result = await fn(data);
    await write(data);
    return result;
  });
}
