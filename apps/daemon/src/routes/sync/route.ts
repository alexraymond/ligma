import { NextResponse } from '../../http';
import { syncAllAgentCommands, syncAllSkillFiles } from '../../store/sync-commands';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sync — Regenerates all `.claude/commands/` and `skills/` files
 * from the agent registry and skills library JSON data.
 */
export async function POST() {
  try {
    await syncAllAgentCommands();
    await syncAllSkillFiles();
    return NextResponse.json({ ok: true, message: 'All agent commands and skill files synced.' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: 'Sync failed', details: message }, { status: 500 });
  }
}
