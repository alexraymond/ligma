/**
 * GET/POST /api/projects/:id/designs — list designs, start a design session.
 *
 * Designs are central, not in-repo: they are product artifacts, not knowledge
 * that should travel with the code (CONTRACTS-phase3 "Data model").
 */

import type { CreateDesignAttachmentRequest } from '@ligma/api';
import { NextResponse } from '../../../../http';
import { saveAttachment } from '../../../../studio/attachments';
import { assertSafeDesignSystem } from '../../../../studio/paths';
import { startTurn } from '../../../../studio/session';
import { createDesign, listDesigns, toSummary } from '../../../../studio/store';
import { findProject } from '../_lib';
import { badRequest, jsonBody } from './_lib';

/**
 * Shapes whose pipeline has no design stage (UX spec §3).
 *
 * "A headless project never sees a Studio" was enforced only in web navigation,
 * so the MCP surface, the CLI or a stray client could attach Studio state to a
 * headless project and burn governor spawns on a design nothing would ever
 * surface (process audit P17). `?force=true` is the explicit opt-in for the
 * case where a project's shape is simply wrong.
 */
const SHAPES_WITHOUT_DESIGN_STAGE = new Set(['headless', 'artifact']);

/**
 * Reference images sent with the very first prompt.
 *
 * They arrive inline rather than through `POST .../attachments` for the one
 * reason that route cannot serve: there is no design to attach them to until
 * this handler creates one. Same `saveAttachment` underneath, so the caps and
 * the media-type check are the same ones.
 */
function parseAttachments(value: unknown): CreateDesignAttachmentRequest[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = entry as Record<string, unknown>;
    return typeof record?.name === 'string' && typeof record?.dataUrl === 'string'
      ? [{ name: record.name, dataUrl: record.dataUrl }]
      : [];
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json({ projectId: id, designs: (await listDesigns(id)).map(toSummary) });
  } catch (err) {
    return badRequest(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await jsonBody(request);

    const project = await findProject(id);
    const force = new URL(request.url).searchParams.get('force') === 'true';
    if (project?.shape && SHAPES_WITHOUT_DESIGN_STAGE.has(project.shape) && !force) {
      return NextResponse.json(
        {
          error: `This project's shape is "${project.shape}" — its pipeline has no design stage, so a Studio design here would never be surfaced or promoted. Change the shape, or pass ?force=true if the design stage is deliberately opted into.`,
        },
        { status: 409 },
      );
    }

    const prompt = typeof body.prompt === 'string' ? body.prompt : '';
    const title =
      typeof body.title === 'string' && body.title.trim() !== ''
        ? body.title
        : // A design with no name is unfindable on the Wall; derive one rather
          // than asking for something the user already effectively said.
          prompt.trim().slice(0, 60) || 'Untitled design';

    const manifest = await createDesign({
      projectId: id,
      title,
      prompt,
      designSystem: assertSafeDesignSystem(
        typeof body.designSystem === 'string' ? body.designSystem : null,
      ),
    });

    const attachmentIds: string[] = [];
    for (const upload of parseAttachments(body.attachments)) {
      const saved = await saveAttachment(id, manifest.id, upload);
      if (!attachmentIds.includes(saved.id)) attachmentIds.push(saved.id);
    }

    // An opening prompt starts generating immediately — the composer's whole
    // shape is "describe it and watch it appear", so requiring a second call
    // would put a dead screen between the two.
    const turn =
      prompt.trim() !== ''
        ? await startTurn(id, manifest.id, {
            kind: 'prompt',
            prompt,
            ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
          })
        : null;

    return NextResponse.json({ design: toSummary(manifest), turn }, { status: 201 });
  } catch (err) {
    return badRequest(err);
  }
}
