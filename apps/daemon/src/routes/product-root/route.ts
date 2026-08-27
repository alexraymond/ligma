/**
 * `GET /api/product-root` — the Settings → Project locations panel (OD-097):
 * the effective product-repo root and which of the three tiers (env var,
 * configured value, default) won. The env var lives in the daemon's own
 * process, so this can't be computed client-side.
 */
import { NextResponse } from '../../http';
import { productsRootInfo } from '../../store/product-repo';

export async function GET(): Promise<Response> {
  return NextResponse.json(productsRootInfo());
}
