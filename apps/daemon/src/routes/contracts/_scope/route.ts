import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AcceptanceContract } from '@ligma/api';
import { type NextRequest, NextResponse } from '../../../http';
import { DATA_DIR } from '../../../paths';

/**
 * Read-only view of the acceptance contracts the harness writes.
 *
 * Storage is one append-only JSONL per scope (`data/contracts/<taskId>.jsonl`),
 * newest version last — see scripts/harness/contract-store.ts, which owns
 * writing. This route deliberately re-implements the read path instead of
 * importing that module: scripts/harness is Node-only tooling (file locks,
 * signing) and must never be pulled into the Next runtime.
 */

/** Root directory for acceptance contracts. Overridable for tests. */
function getContractsRoot(): string {
  const override = process.env.CONTRACTS_DIR;
  return path.resolve(override || path.join(DATA_DIR, 'contracts'));
}

// GET /api/contracts/[scope]?version=N
// Without ?version: every version for the scope, ascending.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ scope: string }> },
) {
  const { scope } = await params;

  // basename() is the containment rule (same as contract-store): a scope that
  // isn't already its own basename is trying to walk out of the contracts dir.
  if (!scope || path.basename(scope) !== scope) {
    return NextResponse.json({ error: 'Invalid scope' }, { status: 400 });
  }

  const file = path.join(getContractsRoot(), `${scope}.jsonl`);
  let raw: string;
  try {
    raw = await readFile(file, 'utf-8');
  } catch {
    return NextResponse.json({ error: 'No contract for this scope' }, { status: 404 });
  }

  const contracts: AcceptanceContract[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      contracts.push(JSON.parse(line) as AcceptanceContract);
    } catch {
      // A corrupt line means part of the oracle is unreadable — skip it loudly.
      console.error(`[api/contracts] skipping unparseable line in ${file}`);
    }
  }
  contracts.sort((a, b) => a.version - b.version);

  const versionParam = request.nextUrl.searchParams.get('version');
  if (versionParam !== null) {
    const version = Number(versionParam);
    const match = contracts.filter((c) => c.version === version);
    if (match.length === 0) {
      return NextResponse.json(
        { error: `No version ${versionParam} for this scope` },
        { status: 404 },
      );
    }
    return NextResponse.json({ scope, contracts: match });
  }

  return NextResponse.json({ scope, contracts });
}
