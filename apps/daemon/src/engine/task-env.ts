/**
 * task-env.ts — where a task's builder runs, and whether what it built can be booted.
 *
 * Two facts, both derived from one place so the dispatcher, the standalone
 * run-task entry point and the verification runner cannot disagree:
 *
 *   1. **Builder cwd.** A task on a project with its own repo is built THERE.
 *      A task on ligma itself — no project, no repoPath, or a repoPath that IS
 *      this checkout — keeps today's behaviour exactly: the runner's own
 *      workspace default. `productRepo()` is the single predicate for "is this
 *      a product repo or are we dogfooding", and it answers null for ligma.
 *
 *   2. **Boot gate.** The consumer panel boots a product from its
 *      `.ligma/boot.json` (twin-primitives §2). A build that finished without
 *      writing one cannot be verified, so it must not slide into
 *      "awaiting verification" as though it could. The failure is reported in
 *      the env-preflight vocabulary — the same `Check` the /launch card renders
 *      — because it IS that failure, found earlier.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Project } from '@ligma/api';
import type { BootRecipe } from '@ligma/api';
import { bootRecipeCheck } from '../env/preflight';
import { DATA_DIR, REPO_ROOT } from '../paths';
import { readBoot } from '../store/ligma-dir';
import { isStubBoot } from '../store/product-repo';
import { withFileLockAsync } from './file-lock';
import { logger } from './logger';

const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const INBOX_FILE = path.join(DATA_DIR, 'inbox.json');

function readRows<T>(file: string, key: string): T[] {
  try {
    if (!existsSync(file)) return [];
    const data = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
    const rows = data[key];
    return Array.isArray(rows) ? (rows as T[]) : [];
  } catch {
    return [];
  }
}

/**
 * The product repo this project is built in, or null when the answer is
 * "ligma itself" — no project, no repoPath, or a repoPath pointing at this very
 * checkout. Null is the legacy path, unchanged in every caller.
 */
export function productRepo(projectId: string | null | undefined): string | null {
  if (!projectId) return null;
  const project = readRows<Project>(PROJECTS_FILE, 'projects').find((p) => p.id === projectId);
  if (!project?.repoPath) return null;
  const resolved = path.resolve(project.repoPath);
  return resolved === path.resolve(REPO_ROOT) ? null : resolved;
}

/** The project a task belongs to, read straight from the store. */
export function taskProjectId(taskId: string): string | null {
  const task = readRows<{ id: string; projectId?: string | null }>(TASKS_FILE, 'tasks').find(
    (t) => t.id === taskId,
  );
  return task?.projectId ?? null;
}

/**
 * The cwd for a builder session. "" keeps the runner's own default, which is
 * what every ligma-self spawn passed before and after this change.
 */
export function builderCwd(projectId: string | null | undefined): string {
  return productRepo(projectId) ?? '';
}

/**
 * The stub-left-behind failure, named once (process audit P12).
 *
 * Greenfield provisioning seeds a valid placeholder recipe so absence is no
 * longer a state a product repo can be in. The cost of that is a second way to
 * fail, and it is the quieter one: the stub PARSES, so `bootRecipeCheck` says
 * "pass" and a build that never wrote a real recipe would verify by reading
 * README.md — forever, and silently. So the gate asks the extra question, and
 * both failures — no recipe, and our recipe still sitting there — are loud.
 */
export const STUB_BOOT_LEFT_IN_PLACE =
  'builder left the stub boot recipe in place — .ligma/boot.json is still the placeholder written when ' +
  'the repo was provisioned, not a recipe for this product';

/** The product repo AND its boot recipe, for the verification env. */
export function taskProductEnv(
  projectId: string | null | undefined,
): { repoPath: string; boot: BootRecipe } | null {
  const repoPath = productRepo(projectId);
  if (!repoPath) return null;
  // Booting the stub would verify the README, not the product.
  if (isStubBoot(repoPath)) throw new Error(STUB_BOOT_LEFT_IN_PLACE);
  const read = readBoot(repoPath);
  if (read.status !== 'ready') {
    // Honest error class: the harness cannot boot this, and saying so beats
    // booting the dogfood adapter and grading the wrong product.
    throw new Error(bootRecipeCheck(repoPath, true).message);
  }
  return { repoPath, boot: read.boot };
}

/**
 * Why this finished build cannot be verified, or null when it can.
 *
 * Only product repos are gated: a ligma-self task is verified by the dogfood
 * adapter, which needs no recipe.
 */
export function bootGateFailure(taskId: string): string | null {
  const repoPath = productRepo(taskProjectId(taskId));
  if (!repoPath) return null;
  if (isStubBoot(repoPath)) return STUB_BOOT_LEFT_IN_PLACE;
  const check = bootRecipeCheck(repoPath, true);
  if (check.status === 'pass') return null;
  return check.message;
}

/**
 * Say it out loud, once per task. A build that produced no boot recipe is a
 * blocked build, not a silent pass — and the message names the fix.
 */
export async function reportBootGate(taskId: string, title: string, reason: string): Promise<void> {
  const marker = 'no valid .ligma/boot.json';
  const body = `${marker}: ${reason}\n\nThe build finished but cannot be verified: the consumer panel boots the product from its\nboot recipe, and there is no real one. The task was NOT marked awaiting-verification.\n\nWrite \`.ligma/boot.json\` in the product repo with: appDir, install, dev (argv arrays),\nportStrategy ({kind:"flag",flag} | {kind:"env",var} | {kind:"fixed",port}), healthPath,\nhealthMarker, seed — then the builder can finish the task.`;
  logger.error('task-env', `Task ${taskId} blocked — ${marker}: ${reason}`);

  try {
    await withFileLockAsync('inbox', async () => {
      const raw = existsSync(INBOX_FILE) ? readFileSync(INBOX_FILE, 'utf-8') : '{"messages":[]}';
      const data = JSON.parse(raw) as { messages: Array<Record<string, unknown>> };
      if (
        data.messages.some(
          (m) => m.taskId === taskId && typeof m.body === 'string' && m.body.includes(marker),
        )
      )
        return;
      data.messages.push({
        id: `msg_${Date.now()}`,
        from: 'system',
        to: 'me',
        type: 'report',
        taskId,
        subject: `Blocked: ${title}`,
        body,
        status: 'unread',
        createdAt: new Date().toISOString(),
        readAt: null,
      });
      writeFileSync(INBOX_FILE, JSON.stringify(data, null, 2), 'utf-8');
    });
  } catch (err) {
    logger.error(
      'task-env',
      `Failed to report the boot gate for ${taskId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
