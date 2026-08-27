/**
 * GET /api/projects/:id/designs/:did/export?format=…[&versionId=] — the design,
 * as a file the user can keep.
 *
 * `packages/exporters` shipped PDF, standalone HTML, ZIP, Markdown and PPTX
 * with tests, and was imported by exactly one file in the repo — the Electron
 * main process (D7 DC-1, OD-109…OD-115). Nothing in it was Electron-locked:
 * the only Electron call in that flow was `dialog.showSaveDialog` picking a
 * destination path, which over HTTP is `Content-Disposition`. So this route is
 * the wiring, not a port.
 *
 * Bodies come from the content-addressed store through the same helper the
 * files route uses, so an exported design is byte-for-byte the design the Wall
 * rendered — never the working tree mid-turn.
 *
 * The exporters write to a path rather than returning bytes (they were built
 * for a save dialog), so each call runs into a private temp dir that is removed
 * on the way out, success or failure.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DesignFileBody } from '@ligma/api';
import {
  type ExporterFormat,
  type MultiFileBundleEntry,
  deckSlides,
  exportArtifact,
  exportMultiFileBundle,
} from '@ligma/exporters';
import { CodesignError, ERROR_CODES } from '@ligma/shared';
import { type NextRequest, NextResponse } from '../../../../../../http';
import { blobsDir } from '../../../../../../studio/paths';
import { readSnapshotBodies } from '../../../../../../studio/snapshots';
import { findVersion, latestVersion } from '../../../../../../studio/store';
import { requireDesign } from '../../_lib';

/** What each format is served as, and the extension of the file it produces. */
const FORMATS: Record<ExporterFormat, { contentType: string; ext: string }> = {
  html: { contentType: 'text/html; charset=utf-8', ext: 'html' },
  pdf: { contentType: 'application/pdf', ext: 'pdf' },
  pptx: {
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ext: 'pptx',
  },
  zip: { contentType: 'application/zip', ext: 'zip' },
  markdown: { contentType: 'text/markdown; charset=utf-8', ext: 'md' },
  // Raster formats (roadmap phase 5): one screen, shot full-height by the same
  // Chrome the PDF path drives. `jpeg` keeps the exporter's own name and hands
  // back a `.jpg` file, because that is the extension a designer double-clicks.
  png: { contentType: 'image/png', ext: 'png' },
  jpeg: { contentType: 'image/jpeg', ext: 'jpg' },
  webp: { contentType: 'image/webp', ext: 'webp' },
};

function isFormat(value: string): value is ExporterFormat {
  return value in FORMATS;
}

/**
 * The screen a single-artifact export is *of*.
 *
 * ZIP takes the whole design; PDF, HTML, Markdown and PPTX each produce one
 * document, so they need one HTML file. `index.html` wins when it exists,
 * otherwise the first HTML file in snapshot order — the same file the Wall
 * opens first.
 */
function primaryHtml(files: DesignFileBody[]): DesignFileBody | null {
  const html = files.filter((f) => f.path.toLowerCase().endsWith('.html'));
  return html.find((f) => f.path.toLowerCase() === 'index.html') ?? html[0] ?? null;
}

/** A filename the user can find again: design title, version number, format. */
function downloadName(title: string, versionN: number, ext: string): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'design';
  return `${slug}-v${versionN}.${ext}`;
}

/**
 * Exporter failures carry a code; the daemon's error middleware would flatten
 * every one of them to a 500 `{error: message}`. A missing Chrome is the
 * user's environment, not a server fault, so it answers 503 with the code
 * intact and the failure-class cards have something to classify on.
 */
function exportFailure(err: unknown): Response {
  if (err instanceof CodesignError) {
    const status = err.code === ERROR_CODES.EXPORTER_NO_CHROME ? 503 : 500;
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  return NextResponse.json(
    { error: err instanceof Error ? err.message : String(err), code: ERROR_CODES.EXPORTER_UNKNOWN },
    { status: 500 },
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; did: string }> },
) {
  const { id, did } = await params;

  const requestedFormat = request.nextUrl.searchParams.get('format') ?? 'zip';
  if (!isFormat(requestedFormat)) {
    return NextResponse.json(
      { error: `Unknown export format: ${requestedFormat}`, code: ERROR_CODES.EXPORTER_UNKNOWN },
      { status: 400 },
    );
  }

  const found = await requireDesign(id, did);
  if (!found.ok) return found.response;
  const { manifest } = found;

  const requestedVersion = request.nextUrl.searchParams.get('versionId');
  const version = requestedVersion
    ? findVersion(manifest, requestedVersion)
    : latestVersion(manifest);
  if (requestedVersion && !version) {
    return NextResponse.json({ error: `Version not found: ${requestedVersion}` }, { status: 404 });
  }
  if (!version) {
    return NextResponse.json({ error: 'Design has no versions to export yet' }, { status: 409 });
  }

  const files = await readSnapshotBodies(blobsDir(id, did), version.files);
  if (files.length === 0) {
    return NextResponse.json({ error: 'Design snapshot has no readable files' }, { status: 409 });
  }

  const { contentType, ext } = FORMATS[requestedFormat];
  const filename = downloadName(manifest.title, version.n, ext);

  const staging = await mkdtemp(path.join(tmpdir(), 'ligma-export-'));
  try {
    const destination = path.join(staging, filename);

    if (requestedFormat === 'zip') {
      const entries: MultiFileBundleEntry[] = files.map((f) => ({ path: f.path, content: f.body }));
      await exportMultiFileBundle(entries, destination);
    } else {
      const primary = primaryHtml(files);
      if (!primary) {
        return NextResponse.json(
          { error: `This design has no HTML file to export as ${requestedFormat}; use format=zip` },
          { status: 409 },
        );
      }
      // P16: this route knows what it is exporting — it is holding the whole
      // snapshot — so it decides the PDF's page format instead of leaving the
      // exporter to auto-detect from the class names. A deck gets a page per
      // slide; anything else is pinned to paper, so a stray
      // `<section class="slide">` in a landing page cannot silently paginate it.
      await exportArtifact(requestedFormat, primary.body, destination, {
        pdfPageFormat: deckSlides(primary.body) === null ? 'Letter' : 'deck',
      });
    }

    const bytes = await readFile(destination);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        // The bytes are addressed by an immutable snapshot; a stale copy would
        // claim to be a version it is not.
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return exportFailure(err);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
