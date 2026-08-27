import { type NextRequest, NextResponse } from '../../../http';
import { type CheckpointFile, saveCheckpoint } from '../../../store/data';

// POST /api/checkpoints/import — Import a checkpoint file (adds to list, does NOT auto-load)
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as unknown;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid checkpoint format' }, { status: 400 });
    }

    const snap = body as Record<string, unknown>;

    // Validate required top-level fields
    if (typeof snap.name !== 'string' || !snap.name.trim()) {
      return NextResponse.json({ error: 'Checkpoint must have a name' }, { status: 400 });
    }
    if (typeof snap.data !== 'object' || snap.data === null) {
      return NextResponse.json({ error: 'Checkpoint must have a data object' }, { status: 400 });
    }

    const data = snap.data as Record<string, unknown>;
    const requiredKeys = [
      'tasks',
      'goals',
      'projects',
      'brainDump',
      'inbox',
      'decisions',
      'agents',
      'skillsLibrary',
    ];
    for (const key of requiredKeys) {
      if (!(key in data)) {
        return NextResponse.json({ error: `Checkpoint data missing "${key}"` }, { status: 400 });
      }
    }

    // Assign a new ID to avoid collisions with existing checkpoints
    const importedSnap: CheckpointFile = {
      id: `snap_${Date.now()}`,
      name: String(snap.name).trim().slice(0, 200),
      description: String(snap.description ?? '')
        .trim()
        .slice(0, 1000),
      createdAt: typeof snap.createdAt === 'string' ? snap.createdAt : new Date().toISOString(),
      version: typeof snap.version === 'number' ? snap.version : 1,
      data: data as CheckpointFile['data'],
    };

    await saveCheckpoint(importedSnap);

    return NextResponse.json({
      ok: true,
      id: importedSnap.id,
      name: importedSnap.name,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to import checkpoint', details: String(err) },
      { status: 500 },
    );
  }
}
