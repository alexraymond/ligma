/**
 * GET/POST /api/projects/:id/talk — the project's Talk thread (UX spec §10).
 *
 * The human's message is written synchronously and returned, so the drawer's
 * optimistic append is confirmed by a real record. The machine's answer is a
 * *separate* message that arrives later: the respond pass is dispatched
 * fire-and-forget and appends its own turn (or an honest system note about why
 * it couldn't), and the drawer's poll picks it up. Holding the POST open for a
 * model round-trip is what makes a chat feel broken when the governor defers.
 */

import { z } from 'zod';
import { logger } from '../../engine/logger';
import { runTalkRespond } from '../../engine/run-talk-respond';
import { NextResponse } from '../../http';
import { getAgents } from '../../store/data';
import { badRequest, findProject } from '../projects/_id/_lib';
import { appendTalkMessage, readTalk } from './store';

const postSchema = z.object({
  body: z.string().min(1).max(4000),
  /** "system" (the default) or the id of a crew member to address. */
  to: z.string().min(1).max(80).optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    if (!(await findProject(id)))
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    const { messages } = await readTalk(id);
    return NextResponse.json({ projectId: id, messages });
  } catch (err) {
    return badRequest(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    if (!(await findProject(id)))
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const parsed = postSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
        { status: 400 },
      );
    }

    // An addressed role has to be a role that exists. The composer only ever
    // sends ids it read from the registry, so a miss here is a stale client —
    // and answering as a crew member who does not exist is worse than a 400.
    const to = parsed.data.to ?? 'system';
    if (to !== 'system') {
      const { agents } = await getAgents();
      if (!agents.some((a) => a.id === to)) {
        return NextResponse.json({ error: `No crew member with id "${to}"` }, { status: 400 });
      }
    }

    const message = await appendTalkMessage(id, { author: 'you', body: parsed.data.body });

    // Fire and forget: the pass appends its own message when it lands.
    void runTalkRespond(id, message, to).catch((err) => {
      logger.error(
        'talk',
        `Respond dispatch threw for ${id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    return NextResponse.json({ projectId: id, message }, { status: 201 });
  } catch (err) {
    return badRequest(err);
  }
}
