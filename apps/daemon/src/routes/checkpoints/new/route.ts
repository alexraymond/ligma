/**
 * POST /api/checkpoints/new — start over with an empty workspace.
 *
 * This is a WIPE, not a save (the URL reads the other way round; `POST
 * /api/checkpoints` is the one that saves). It used to be one unguarded POST
 * from total data loss: no confirmation, no snapshot, no engine guard, and it
 * left the central project dirs, contracts and verification runs behind
 * pointing at rows that no longer existed (process audit P2).
 *
 * Four things now stand between a request and an empty workspace:
 *   1. `{confirm: true}` in the body — a stray or cross-site POST can't say it.
 *   2. The same engine-stopped guard `checkpoints/load` has: a wipe under a
 *      live dispatcher is a restore under a live dispatcher.
 *   3. An automatic pre-wipe checkpoint, so there is always something to go
 *      back to even for a workspace that had never saved one.
 *   4. An archive sweep of the out-of-store directories, so nothing survives
 *      referring to deleted rows.
 */

import { exec } from 'node:child_process';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { isEngineRunning } from '../../../engine/lifecycle';
import { type NextRequest, NextResponse } from '../../../http';
import { DAEMON_ROOT, DATA_DIR } from '../../../paths';
import {
  type CheckpointFile,
  getActiveRuns,
  getAllCoreData,
  saveActivityLog,
  saveAgents,
  saveBrainDump,
  saveCheckpoint,
  saveDecisions,
  saveGoals,
  saveInbox,
  saveProjects,
  saveSkillsLibrary,
  saveTasks,
} from '../../../store/data';
import { restoreBlockedReason } from '../load/route';

const execAsync = promisify(exec);

/**
 * The store lives in 8 JSON files; the evidence does not. These three
 * directories are keyed by project / task / run id, so a wipe that leaves them
 * in place leaves live-looking Deck cards and contracts for rows that are gone.
 *
 * Moved, never deleted: a checkpoint only covers the JSON stores (P19), so
 * deleting the evidence would make the pre-wipe snapshot a partial restore of
 * something unrecoverable. `<DATA_DIR>/archive/<iso>/` is a plain rename.
 */
const SWEPT_DIRS = ['projects', 'contracts', 'verification-runs'] as const;

/**
 * Out-of-store JSON files keyed by ids the wipe destroys. Same rename, same
 * reason: `spot-check-reviews.json` remembers "the human already audited run X",
 * and a run X that no longer exists makes that memory a permanent hold on
 * nothing. It is NOT covered by a checkpoint (see CHECKPOINT_SCOPE) — it is a
 * disposable ledger of answers, so it is swept out rather than snapshotted in.
 */
const SWEPT_FILES = ['spot-check-reviews.json'] as const;

function sweepOrphans(stamp: string): string[] {
  const dest = path.join(DATA_DIR, 'archive', stamp);
  const moved: string[] = [];
  for (const name of [...SWEPT_DIRS, ...SWEPT_FILES]) {
    const from = path.join(DATA_DIR, name);
    if (!existsSync(from)) continue;
    mkdirSync(dest, { recursive: true });
    renameSync(from, path.join(dest, name));
    moved.push(name);
  }
  return moved;
}

// Default agents for a fresh workspace (the 5 built-in roles)
const DEFAULT_AGENTS = [
  {
    id: 'me',
    name: 'Me',
    icon: 'User',
    description: 'Tasks I handle myself — decisions, approvals, creative direction',
    instructions: '',
    capabilities: ['decisions', 'approvals', 'creative-direction'],
    skillIds: [],
    status: 'active' as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'researcher',
    name: 'Researcher',
    icon: 'Search',
    description: 'Market research, competitive analysis, evaluation',
    instructions: '',
    capabilities: ['web-research', 'analysis', 'evaluation'],
    skillIds: [],
    status: 'active' as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'developer',
    name: 'Developer',
    icon: 'Code',
    description: 'Code, bug fixes, testing, deployment',
    instructions: '',
    capabilities: ['coding', 'testing', 'debugging', 'deployment'],
    skillIds: [],
    status: 'active' as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'marketer',
    name: 'Marketer',
    icon: 'Megaphone',
    description: 'Copy, growth strategy, content, SEO',
    instructions: '',
    capabilities: ['copywriting', 'seo', 'content-strategy', 'growth'],
    skillIds: [],
    status: 'active' as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'business-analyst',
    name: 'Business Analyst',
    icon: 'BarChart3',
    description: 'Strategy, planning, prioritization, financials',
    instructions: '',
    capabilities: ['strategy', 'analysis', 'planning', 'financial-modeling'],
    skillIds: [],
    status: 'active' as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

// POST /api/checkpoints/new — Create a fresh empty workspace
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { confirm?: unknown };
    if (body.confirm !== true) {
      return NextResponse.json(
        {
          error:
            'This erases the whole workspace — every project, task, goal, inbox message, decision, ' +
            'brain-dump entry and skill. Re-send with {"confirm": true} to go ahead.',
        },
        { status: 400 },
      );
    }

    const { runs } = await getActiveRuns();
    const blockedReason = restoreBlockedReason(isEngineRunning(), runs, 'erasing the workspace');
    if (blockedReason) {
      return NextResponse.json({ error: blockedReason }, { status: 409 });
    }

    // Snapshot BEFORE anything is touched. A wipe with no checkpoint to go back
    // to has no recovery path at all, and the walk that found P2 hit exactly
    // that: zero checkpoints existed at the time.
    const stamp = new Date().toISOString();
    const backup: CheckpointFile = {
      id: `snap_${Date.now()}`,
      name: `Before new workspace — ${stamp}`,
      description: 'Taken automatically by POST /api/checkpoints/new before erasing the workspace.',
      createdAt: stamp,
      version: 1,
      data: await getAllCoreData(),
    };
    await saveCheckpoint(backup);

    await saveTasks({ tasks: [] });
    await saveGoals({ goals: [] });
    await saveProjects({ projects: [] });
    await saveBrainDump({ entries: [] });
    await saveInbox({ messages: [] });
    await saveDecisions({ decisions: [] });
    await saveAgents({ agents: DEFAULT_AGENTS });
    await saveSkillsLibrary({ skills: [] });
    await saveActivityLog({ events: [] });

    // Contracts, per-project dirs and verification runs go with the rows they
    // describe — otherwise the Deck keeps showing spot-check cards for wiped
    // tasks (observed in the P2 walk).
    const archivedDirs = sweepOrphans(stamp.replace(/[:.]/g, '-'));

    // Regenerate AI context in background.
    // Invoked directly rather than through `pnpm gen:context`, whose script line
    // pins `LIGMA_DATA_DIR=../../data` — so a workspace on any other data dir
    // regenerated the wrong store's context (and a test wipe rewrote the
    // maintainer's live one). The child inherits this process's data dir.
    execAsync('pnpm exec tsx scripts/generate-context.ts', { cwd: DAEMON_ROOT }).catch(() => {});

    return NextResponse.json({
      ok: true,
      checkpointId: backup.id,
      checkpointName: backup.name,
      archivedDirs,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to create new workspace', details: String(err) },
      { status: 500 },
    );
  }
}
