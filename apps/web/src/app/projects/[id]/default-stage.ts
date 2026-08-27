/**
 * Which stage a project's `/projects/:id` visit lands on. One rule, one
 * implementation: `lib/rail.ts`'s `defaultStageSegment` (the rail's avatars
 * and ⌘K land through the same door). This module only adapts the page's
 * inputs — it exists because Next's typed-pages check rejects extra exports
 * on `page.tsx` itself.
 */
import { defaultStageSegment } from '@/lib/rail';

export function defaultStagePath(
  projectId: string,
  { designShaped, taskCount }: { designShaped: boolean; taskCount: number },
): string {
  return `/projects/${projectId}/${defaultStageSegment(designShaped, taskCount > 0)}`;
}
