import { type NextRequest, NextResponse } from '../../../http';
import { getCheckpoint } from '../../../store/data';

// GET /api/checkpoints/export?id={id} — Download a checkpoint as a JSON file
export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Checkpoint ID is required' }, { status: 400 });
    }
    // Validate ID format to prevent path traversal
    if (!/^snap_(\d+|demo)$/.test(id)) {
      return NextResponse.json({ error: 'Invalid checkpoint ID' }, { status: 400 });
    }

    const snap = await getCheckpoint(id);
    const json = JSON.stringify(snap, null, 2);
    const safeName = snap.name
      .replace(/[^a-zA-Z0-9-_ ]/g, '')
      .replace(/\s+/g, '-')
      .toLowerCase();
    const filename = `${safeName || id}.json`;

    return new NextResponse(json, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to export checkpoint', details: String(err) },
      { status: 500 },
    );
  }
}
