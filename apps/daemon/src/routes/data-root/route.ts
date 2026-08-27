/**
 * GET /api/data-root — where the daemon's store physically lives, and which
 * source decided it (env override or the ~/.ligma default). Companion to
 * /api/product-root; exists so "where does my data go" is answerable from
 * the UI instead of by reading paths.ts.
 */

import { NextResponse } from '../../http';
import { dataRootInfo } from '../../paths';

export async function GET() {
  return NextResponse.json(dataRootInfo());
}
