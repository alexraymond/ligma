'use client';

import { apiFetch } from '@/lib/api-client';
import { useCollection } from '@/providers/collections-provider';
import type { Brief, DesignSummary } from '@ligma/api';
import { useCallback } from 'react';

/**
 * The two Phase-3 stages the pipeline strip needs beyond tasks and runs.
 *
 * A project with no brief is normal (adoption), and designs genuinely absent
 * is normal too — those are real "no probes" claims. A *failed* read is a
 * different claim ("could not read them", project-health-board.tsx's rule)
 * and must not be folded into the same absent state: `brief`/`designs` never
 * get reset by a failed fetch, they just keep whatever was last confirmed
 * (or the initial absent value, on a first load that fails). `error` carries
 * the failure so a caller can tell the two apart.
 *
 * This matters beyond cosmetics: the pipeline strip's tab row reads `brief`
 * truthiness and `designs` to decide whether the Brief/Studio tabs exist at
 * all (`projects/[id]/layout.tsx`). Collapsing "couldn't load" into "doesn't
 * exist" used to delete those tabs on a transient failure.
 */
const EMPTY_DESIGNS: readonly DesignSummary[] = [];

/**
 * The two keys this pipeline is cached under — one per leg, so a failure on one
 * can't reset the other (the docblock's rule) and either can be invalidated on
 * its own. Promoting a design invalidates both (F6): the strip's chips and the
 * Brief/Studio tabs used to stay frozen until a hard reload.
 */
export function projectPipelineKeys(projectId: string): [briefKey: string, designsKey: string] {
  return [`/api/projects/${projectId}/brief`, `/api/projects/${projectId}/designs`];
}

export function useProjectPipeline(projectId: string): {
  brief: Brief | null;
  designs: DesignSummary[];
  error: string | null;
  refetch: () => Promise<void>;
} {
  const [briefKey, designsKey] = projectPipelineKeys(projectId);

  const fetchBrief = useCallback(async (): Promise<Brief | null> => {
    const res = await apiFetch(briefKey);
    if (!res.ok) throw new Error(`brief fetch failed (${res.status})`);
    const json = (await res.json()) as { brief?: Brief };
    return json.brief ?? null;
  }, [briefKey]);

  const fetchDesigns = useCallback(async (): Promise<DesignSummary[]> => {
    const res = await apiFetch(designsKey);
    // A 404 means the designs API isn't mounted in this build — a
    // legitimate "no design stage" (per the docblock), not a failure.
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`designs fetch failed (${res.status})`);
    const json = (await res.json()) as { designs?: DesignSummary[] };
    return json.designs ?? [];
  }, [designsKey]);

  const {
    data: brief,
    error: briefError,
    refetch: refetchBrief,
  } = useCollection<Brief | null>(briefKey, fetchBrief);
  const {
    data: designs,
    error: designsError,
    refetch: refetchDesigns,
  } = useCollection<DesignSummary[]>(designsKey, fetchDesigns);

  const refetch = useCallback(async () => {
    await Promise.all([refetchBrief(), refetchDesigns()]);
  }, [refetchBrief, refetchDesigns]);

  return {
    brief: brief ?? null,
    designs: (designs ?? EMPTY_DESIGNS) as DesignSummary[],
    error: briefError ?? designsError,
    refetch,
  };
}
