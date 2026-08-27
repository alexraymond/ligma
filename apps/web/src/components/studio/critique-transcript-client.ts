/**
 * Client-side reader for a critique run's persisted transcript — the
 * Replay control's data source.
 *
 * Calls `GET {designUrl}/critique-transcript`
 * (`apps/daemon/src/routes/projects/_id/designs/_did/critique-transcript/route.ts`),
 * which reads through `readLatestCritiqueTranscript`
 * (`apps/daemon/src/studio/critic-transcript.ts`). A fetch failure surfaces as
 * an error in Replay rather than doing nothing silently.
 */

import { apiFetch } from '@/lib/api-client';
import type { DesignCriticEvent } from '@ligma/api';
import { designUrl } from './api';

export async function fetchLatestCritiqueTranscript(
  projectId: string,
  designId: string,
): Promise<DesignCriticEvent[]> {
  const res = await apiFetch(`${designUrl(projectId, designId)}/critique-transcript`, {
    retries: 0,
  });
  if (!res.ok) {
    throw new Error(`critique transcript fetch failed: ${res.status}`);
  }
  const body = (await res.json().catch(() => null)) as { events?: DesignCriticEvent[] } | null;
  return body?.events ?? [];
}
