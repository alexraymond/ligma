/**
 * GET/POST/DELETE /api/checkpoints — the workspace snapshot list.
 *
 * `POST /api/checkpoints/new` is the WIPE, not a save. This is the save.
 */

import { type NextRequest, NextResponse } from '../../http';
import {
  type CheckpointFile,
  deleteCheckpoint,
  getAllCoreData,
  listCheckpoints,
  saveCheckpoint,
} from '../../store/data';

/**
 * What a checkpoint does and does not cover, said out loud at create and
 * restore time.
 *
 * A snapshot is the 8 JSON stores. Briefs, contracts, verification runs, the
 * activity log and the product repos are outside it, so restoring after any
 * promote/verify activity can resurrect task rows whose contract chain is gone
 * — and nothing in the flow used to mention it (process audit P19). Returned
 * with the create and load responses so a client can show it without a second
 * source of truth.
 */
export const CHECKPOINT_SCOPE = {
  covers: [
    'tasks',
    'goals',
    'projects',
    'brain-dump',
    'inbox',
    'decisions',
    'agents',
    'skills library',
  ],
  excludes: [
    'briefs',
    'contracts',
    'verification runs and their evidence',
    'activity log',
    'product repositories',
    // Disposable by design: a flat ledger of "the human already audited run X".
    // POST /api/checkpoints/new sweeps it into the archive with the runs it
    // names, so a wipe cannot leave answers standing for evidence that is gone.
    'verdict spot-check reviews',
  ],
  note:
    'Restoring can bring back task rows whose contracts, briefs or verification evidence are no ' +
    'longer on disk (and leave contracts for tasks that are gone). It is a snapshot of the board, ' +
    'not of the workspace.',
} as const;

// GET /api/checkpoints — List all saved checkpoints (metadata only)
export async function GET() {
  try {
    const metas = await listCheckpoints();
    return NextResponse.json(metas);
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to list checkpoints', details: String(err) },
      { status: 500 },
    );
  }
}

// POST /api/checkpoints — Save current workspace as a named checkpoint
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { name?: string; description?: string };
    const name = (body.name ?? '').trim();
    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    if (name.length > 200) {
      return NextResponse.json({ error: 'Name must be under 200 characters' }, { status: 400 });
    }
    const description = (body.description ?? '').trim().slice(0, 1000);

    const data = await getAllCoreData();
    const id = `snap_${Date.now()}`;
    const snap: CheckpointFile = {
      id,
      name,
      description,
      createdAt: new Date().toISOString(),
      version: 1,
      data,
    };
    await saveCheckpoint(snap);

    return NextResponse.json({
      id: snap.id,
      name: snap.name,
      description: snap.description,
      createdAt: snap.createdAt,
      version: snap.version,
      scope: CHECKPOINT_SCOPE,
      stats: {
        tasks: data.tasks.tasks.length,
        projects: data.projects.projects.length,
        goals: data.goals.goals.length,
        brainDump: data.brainDump.entries.length,
        inbox: data.inbox.messages.length,
        decisions: data.decisions.decisions.length,
        agents: data.agents.agents.length,
        skills: data.skillsLibrary.skills.length,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to save checkpoint', details: String(err) },
      { status: 500 },
    );
  }
}

// DELETE /api/checkpoints?id={id} — Delete a checkpoint
export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Checkpoint ID is required' }, { status: 400 });
    }
    // Validate ID format to prevent path traversal
    if (!/^snap_(\d+|demo)$/.test(id)) {
      return NextResponse.json({ error: 'Invalid checkpoint ID' }, { status: 400 });
    }
    await deleteCheckpoint(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to delete checkpoint', details: String(err) },
      { status: 500 },
    );
  }
}
