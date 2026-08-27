/**
 * Reference images attached to a design's composer — "make it look like this".
 *
 * Storage follows the design directory's existing discipline (`./paths`): the
 * bytes live in `attachments/`, a *sibling* of `src/`, never inside it. An
 * attachment is an input to the design, and a file in `src/` would be picked up
 * by `snapshots.ts`'s walk — it would render as a screen on the Wall and land
 * in every version from then on.
 *
 * Filenames are content-addressed the same way `blobs/` are, so dropping the
 * same screenshot into two turns stores one file. The sidecar `index.json`
 * exists only to remember the name the human dropped and the media type; the
 * bytes on disk are the authority for everything else.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CreateDesignAttachmentRequest, DesignAttachment } from '@ligma/api';
import { designDir } from './paths';

/** Same cap the web composer checks first (`workspace/file-upload.ts`). */
export const MAX_ATTACHMENT_BYTES = 5_000_000;

/** Per design, not per turn — a moodboard, not a photo album. */
export const MAX_ATTACHMENTS = 24;

/**
 * Only image types the model wire actually accepts as input. A PDF or a Figma
 * export would upload happily and then be silently dropped from the turn,
 * which is worse than refusing it here.
 */
const EXTENSION_BY_MEDIA_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const DATA_URL = /^data:([a-zA-Z0-9.+/-]+);base64,([A-Za-z0-9+/=]+)$/;

/** Ids are minted here and then interpolated into a path, so they are checked. */
const ID_PATTERN = /^[0-9a-f]{64}\.(png|jpg|webp|gif)$/;

export function attachmentsDir(projectId: string, designId: string): string {
  return path.join(designDir(projectId, designId), 'attachments');
}

function indexPath(projectId: string, designId: string): string {
  return path.join(attachmentsDir(projectId, designId), 'index.json');
}

export function attachmentPath(projectId: string, designId: string, id: string): string {
  if (!ID_PATTERN.test(id)) throw new Error(`Invalid attachment id "${id}"`);
  return path.join(attachmentsDir(projectId, designId), id);
}

export async function listAttachments(
  projectId: string,
  designId: string,
): Promise<DesignAttachment[]> {
  try {
    const raw = await readFile(indexPath(projectId, designId), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DesignAttachment[]) : [];
  } catch {
    // No index, or a half-written one: a design with no readable attachments
    // is the same thing as a design with none, and the turn still runs.
    return [];
  }
}

/**
 * Decode and store one upload, returning what it became.
 *
 * Validation is at this boundary rather than in the route so the create-design
 * path and the upload route cannot disagree about what is acceptable. Storing
 * the same bytes twice returns the existing entry rather than a second copy —
 * content-addressing makes that free, and it keeps the same screenshot dropped
 * on two turns from filling the cap.
 */
export async function saveAttachment(
  projectId: string,
  designId: string,
  input: CreateDesignAttachmentRequest,
): Promise<DesignAttachment> {
  const name = input.name.trim();
  if (name === '' || name.length > 255)
    throw new Error('attachment `name` must be 1–255 characters');

  const match = DATA_URL.exec(input.dataUrl);
  if (!match) throw new Error('`dataUrl` must be base64-encoded: data:<mime>;base64,<data>');
  const mediaType = match[1];
  const extension = EXTENSION_BY_MEDIA_TYPE[mediaType];
  if (!extension) {
    throw new Error(
      `${mediaType} is not an image the designer can look at — use PNG, JPEG, WebP or GIF`,
    );
  }

  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `Attachment is ${bytes.byteLength} bytes — the ${MAX_ATTACHMENT_BYTES}-byte cap keeps a turn sendable`,
    );
  }

  const existing = await listAttachments(projectId, designId);
  const id = `${createHash('sha256').update(bytes).digest('hex')}.${extension}`;
  const already = existing.find((entry) => entry.id === id);
  if (already) return already;
  if (existing.length >= MAX_ATTACHMENTS) {
    throw new Error(
      `This design already has ${MAX_ATTACHMENTS} attachments — remove one before adding another`,
    );
  }

  const attachment: DesignAttachment = {
    id,
    name,
    mediaType,
    byteSize: bytes.byteLength,
    createdAt: new Date().toISOString(),
  };
  const dir = attachmentsDir(projectId, designId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, id), bytes);
  // ponytail: read-modify-write, no lock. The daemon is one localhost process
  // and an upload is a human click; add a lock if uploads ever become batched.
  await writeFile(
    indexPath(projectId, designId),
    `${JSON.stringify([...existing, attachment], null, 2)}\n`,
    'utf-8',
  );
  return attachment;
}

/**
 * Turn the ids a turn asked for into attachments, or refuse the turn.
 *
 * Unknown ids are an error, not a silent drop: a turn that quietly forgets the
 * reference image the user attached would produce a design that ignored it and
 * no way to tell that from the model ignoring it.
 */
export function resolveAttachments(all: DesignAttachment[], ids: string[]): DesignAttachment[] {
  return ids.map((id) => {
    const found = all.find((entry) => entry.id === id);
    if (!found) throw new Error(`Unknown attachment "${id}" — upload it before sending the turn`);
    return found;
  });
}

/** The bytes, base64, ready to become an image block on the model turn. */
export async function readAttachmentBase64(
  projectId: string,
  designId: string,
  attachment: DesignAttachment,
): Promise<string> {
  const bytes = await readFile(attachmentPath(projectId, designId, attachment.id));
  return bytes.toString('base64');
}
