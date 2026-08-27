/**
 * GET/POST /api/references/:id — the project's reference/mood-board (OD-048/
 * OD-137): URLs with a server-scraped title, plus user-uploaded screenshots.
 *
 * The title scrape happens here, server-side, at add-time only — never again
 * on read, so the board never re-fetches a link a user has already saved (and
 * never becomes a vector for reading whatever a saved URL serves today).
 */

import { z } from 'zod';
import { NextResponse } from '../../../http';
import { badRequest, findProject } from '../../projects/_id/_lib';
import { type ReferenceItem, mutateWorkspace, newWorkspaceId, readWorkspace } from '../store';

/** Raw decoded bytes, not the (~33% larger) base64 string length. */
const MAX_IMAGE_BYTES = 5_000_000;
const MAX_REFERENCES = 200;
const SCRAPE_TIMEOUT_MS = 5_000;

const DATA_URL = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/;

const addLinkSchema = z.object({
  kind: z.literal('link'),
  url: z.string().url().max(2000),
  note: z.string().max(2000).optional().default(''),
});

const addScreenshotSchema = z.object({
  kind: z.literal('screenshot'),
  dataUrl: z.string().min(1),
  note: z.string().max(2000).optional().default(''),
});

const addSchema = z.discriminatedUnion('kind', [addLinkSchema, addScreenshotSchema]);

/** Best-effort `<title>` scrape. Any failure — network, timeout, no tag — falls back to the hostname. */
async function scrapeTitle(url: string): Promise<string> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS) });
    const html = await res.text();
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
    return title && title.length > 0 ? title : new URL(url).hostname;
  } catch {
    return new URL(url).hostname;
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    if (!(await findProject(id)))
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    const { references } = await readWorkspace(id);
    return NextResponse.json({ projectId: id, references });
  } catch (err) {
    return badRequest(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    if (!(await findProject(id)))
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const parsed = addSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
        { status: 400 },
      );
    }

    let item: ReferenceItem;
    if (parsed.data.kind === 'link') {
      const { url, note } = parsed.data;
      item = {
        id: newWorkspaceId('ref'),
        kind: 'link',
        url,
        title: await scrapeTitle(url),
        domain: new URL(url).hostname,
        note,
        createdAt: new Date().toISOString(),
      };
    } else {
      const { dataUrl, note } = parsed.data;
      const match = DATA_URL.exec(dataUrl);
      if (!match) {
        return NextResponse.json(
          { error: 'dataUrl must be a base64-encoded image: data:image/<type>;base64,<data>' },
          { status: 400 },
        );
      }
      const byteLength = Math.floor((match[2].length * 3) / 4);
      if (byteLength > MAX_IMAGE_BYTES) {
        return NextResponse.json(
          { error: `Image exceeds the ${Math.floor(MAX_IMAGE_BYTES / 1_000_000)}MB cap` },
          { status: 413 },
        );
      }
      item = {
        id: newWorkspaceId('ref'),
        kind: 'screenshot',
        dataUrl,
        mime: match[1],
        note,
        createdAt: new Date().toISOString(),
      };
    }

    const references = await mutateWorkspace(id, (data) => {
      if (data.references.length >= MAX_REFERENCES) {
        throw new Error(
          `This project already has ${MAX_REFERENCES} references — delete one before adding another`,
        );
      }
      data.references.push(item);
      return data.references;
    });

    return NextResponse.json({ projectId: id, references }, { status: 201 });
  } catch (err) {
    return badRequest(err);
  }
}
