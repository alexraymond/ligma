import { z } from 'zod';
import { FIX_KINDS, applyPreflightFix } from '../../../env/preflight';
import { NextResponse } from '../../../http';
import { validateBody } from '../../../store/validations';
import { setCachedPreflight } from '../_lib';

/**
 * The whole point: `kind` is validated against a closed union, so the only
 * things this endpoint can ever do are the four branches inside
 * applyPreflightFix. There is no field here that carries a command.
 */
const fixSchema = z.object({ kind: z.enum(FIX_KINDS) }).strict();

// POST /api/env-preflight/fix — apply one fix kind, then re-scan.
export async function POST(request: Request) {
  const parsed = await validateBody(request, fixSchema);
  if (!parsed.success) return parsed.error;

  try {
    const { started, result } = applyPreflightFix(parsed.data.kind);
    setCachedPreflight(result);
    // started = the work outlives this request (chromium install): the check
    // stays "installing…" until a later scan actually finds the binary.
    return NextResponse.json({ started, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Fix failed' },
      { status: 500 },
    );
  }
}
