/**
 * `talk.json` — one thread per project (UX spec §10, Phase 2 contract).
 *
 *   data/projects/<projectId>/talk.json
 *
 * Same layout rule and the same write discipline as `references/store.ts`
 * (per-project mutex, write-then-rename): Talk is a product artifact of one
 * project, not knowledge that travels with the code, so it lives centrally and
 * never in the repo.
 *
 * ponytail: one JSON array, capped, no index. A thread is read whole every time
 * the drawer opens and appended one message at a time — paging it would be
 * infrastructure for a screen that shows the tail.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { TalkMessage, TalkThread } from '@ligma/api';
import { Mutex } from 'async-mutex';
import { logger } from '../../engine/logger';
import { CENTRAL_PROJECTS_DIR } from '../../paths';
import { generateId } from '../../store/ids';
import { assertSafeId } from '../../studio/paths';

/** Matches the notes thread's ceiling — the same "a thread is not a database" call. */
export const MAX_TALK_MESSAGES = 2000;

function talkPath(projectId: string): string {
  return path.join(CENTRAL_PROJECTS_DIR, assertSafeId('projectId', projectId), 'talk.json');
}

const locks = new Map<string, Mutex>();

function lockFor(projectId: string): Mutex {
  let mutex = locks.get(projectId);
  if (!mutex) {
    mutex = new Mutex();
    locks.set(projectId, mutex);
  }
  return mutex;
}

/**
 * The thread, or an empty one for a project that has never talked.
 *
 * A file we cannot parse is moved aside to `talk.json.corrupt-<ts>` and reported
 * before the empty thread is returned: the drawer stays usable, and the next
 * append cannot silently overwrite a conversation that merely failed to parse.
 * Absent and unreadable are still different things — one is logged, one is not.
 */
export async function readTalk(projectId: string): Promise<TalkThread> {
  const file = talkPath(projectId);
  let raw: string;
  try {
    raw = await readFile(file, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { messages: [] };
    throw new Error(
      `Talk thread for ${projectId} is unreadable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    const parsed = JSON.parse(raw) as TalkThread;
    if (!Array.isArray(parsed?.messages)) throw new Error('`messages` is not an array');
    return { messages: parsed.messages };
  } catch (err) {
    const quarantine = `${file}.corrupt-${Date.now()}`;
    await rename(file, quarantine).catch(() => undefined);
    logger.error(
      'talk',
      `Talk thread for ${projectId} was unparseable (${err instanceof Error ? err.message : String(err)}) — moved to ${quarantine}`,
    );
    return { messages: [] };
  }
}

async function writeTalk(projectId: string, data: TalkThread): Promise<void> {
  const file = talkPath(projectId);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
  await rename(tmp, file);
}

/** Read-modify-write under the project's mutex. `fn` mutates `data` in place. */
export async function mutateTalk<T>(projectId: string, fn: (data: TalkThread) => T): Promise<T> {
  return lockFor(projectId).runExclusive(async () => {
    const data = await readTalk(projectId);
    const result = fn(data);
    await writeTalk(projectId, data);
    return result;
  });
}

/**
 * Append one message. The single write path for the thread — the model never
 * edits this file, it returns JSON and we write what survived validation.
 */
export async function appendTalkMessage(
  projectId: string,
  message: Omit<TalkMessage, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
): Promise<TalkMessage> {
  const full: TalkMessage = {
    id: message.id ?? generateId('talk'),
    author: message.author,
    body: message.body,
    createdAt: message.createdAt ?? new Date().toISOString(),
    ...(message.chips && message.chips.length > 0 ? { chips: message.chips } : {}),
  };
  return mutateTalk(projectId, (data) => {
    if (data.messages.length >= MAX_TALK_MESSAGES) {
      throw new Error(`This project's Talk thread already has ${MAX_TALK_MESSAGES} messages`);
    }
    data.messages.push(full);
    return full;
  });
}
