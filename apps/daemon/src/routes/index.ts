import { API_ROUTES } from '@ligma/api';
/**
 * The daemon's HTTP surface — every route the product speaks, mounted at the
 * URLs (and with the request/response shapes) they had as Next.js API routes.
 *
 * The count is deliberately not written down here: it was "35" for a long time
 * after the surface had grown past a hundred, and a number in a comment is a
 * fact that goes stale silently. `Object.keys(MODULES).length` is the count,
 * and `API_ROUTES` is the list.
 *
 * Paths come from @ligma/api's API_ROUTES so web, cli and daemon cannot drift.
 */
import { Router } from 'express';
import { mountRoute } from './adapter';
import { runOutputStream } from './stream';

import * as about from './about/route';
import * as activityLog from './activity-log/route';
import * as adoptionRetry from './adoption/_runId/retry/route';
import * as adoptionReview from './adoption/_runId/review/route';
import * as adoptionRun from './adoption/_runId/route';
import * as agents from './agents/route';
import * as backendsRescan from './backends/rescan/route';
import * as backends from './backends/route';
import * as brainDumpAutomate from './brain-dump/automate/route';
import * as brainDump from './brain-dump/route';
import * as briefs from './briefs/route';
import * as checkpointsExport from './checkpoints/export/route';
import * as checkpointsImport from './checkpoints/import/route';
import * as checkpointsLoad from './checkpoints/load/route';
import * as checkpointsNew from './checkpoints/new/route';
import * as checkpoints from './checkpoints/route';
import * as contracts from './contracts/_scope/route';
import * as craftRules from './craft-rules/route';
import * as daemon from './daemon/route';
import * as dashboard from './dashboard/route';
import * as dataRoot from './data-root/route';
import * as decisionsBulk from './decisions/bulk/route';
import * as decisions from './decisions/route';
import * as deck from './deck/route';
import * as deckSpotCheck from './deck/spot-check/route';
import * as designSystemFile from './design-systems/_id/file/route';
import * as designSystems from './design-systems/route';
import * as designSystemWizardCreateFromTokens from './design-systems/wizard/create-from-tokens/route';
import * as designSystemWizardExtractBrand from './design-systems/wizard/extract-brand/route';
import * as envPreflightFix from './env-preflight/fix/route';
import * as envPreflight from './env-preflight/route';
import * as goals from './goals/route';
import * as inboxRespond from './inbox/respond/route';
import * as inbox from './inbox/route';
import * as libraryMetaBookmark from './library-meta/bookmark/route';
import * as libraryMetaFacets from './library-meta/facets/route';
import * as libraryMeta from './library-meta/route';
import * as libraryMetaUse from './library-meta/use/route';
import * as logs from './logs/route';
import * as mcpHandoffPrompt from './mcp/handoff-prompt/_id/route';
import * as mcpServer from './mcp/servers/_id/route';
import * as mcpServers from './mcp/servers/route';
import * as memoryEntry from './memory/_agentId/_entryId/route';
import * as memory from './memory/_agentId/route';
import * as notificationsTest from './notifications/test/route';
import * as productRoot from './product-root/route';
import * as projectBaseline from './projects/_id/baselines/_jid/route';
import * as projectBaselines from './projects/_id/baselines/route';
import * as projectBriefAmend from './projects/_id/brief/amend/route';
import * as projectBriefAnswers from './projects/_id/brief/answers/route';
import * as projectBrief from './projects/_id/brief/route';
import * as projectDesignApprove from './projects/_id/designs/_did/approve/route';
import * as projectDesignAttachments from './projects/_id/designs/_did/attachments/route';
import * as projectDesignCritiqueTranscript from './projects/_id/designs/_did/critique-transcript/route';
import * as projectDesignExport from './projects/_id/designs/_did/export/route';
import * as projectDesignFiles from './projects/_id/designs/_did/files/route';
import * as projectDesignPinsPreview from './projects/_id/designs/_did/pins/preview/route';
import * as projectDesignPins from './projects/_id/designs/_did/pins/route';
import * as projectDesign from './projects/_id/designs/_did/route';
import * as projectDesignSnapshots from './projects/_id/designs/_did/snapshots/route';
import * as projectDesignStream from './projects/_id/designs/_did/stream/route';
import * as projectDesignTranscript from './projects/_id/designs/_did/transcript/route';
import * as projectDesignTurn from './projects/_id/designs/_did/turn/route';
import * as projectDesigns from './projects/_id/designs/route';
import * as projectEvidencePins from './projects/_id/evidence-pins/route';
import * as projectHealth from './projects/_id/health/route';
import * as projectJourney from './projects/_id/journeys/_jid/route';
import * as projectJourneyRun from './projects/_id/journeys/_jid/run/route';
import * as projectJourneys from './projects/_id/journeys/route';
import * as projectKnowledgeAppend from './projects/_id/knowledge/append/route';
import * as projectKnowledge from './projects/_id/knowledge/route';
import * as projectProbes from './projects/_id/probes/route';
import * as projectPromotePreview from './projects/_id/promote/preview/route';
import * as projectPromote from './projects/_id/promote/route';
import * as project from './projects/_id/route';
import * as projectRun from './projects/_id/run/route';
import * as projectsAdopt from './projects/adopt/route';
import * as projects from './projects/route';
import * as ptyInput from './pty/_id/input/route';
import * as ptyId from './pty/_id/route';
import * as ptyStream from './pty/_id/stream/route';
import * as pty from './pty/route';
import * as referencesRef from './references/_id/_refId/route';
import * as referencesDesignFile from './references/_id/design-files/_fileId/route';
import * as referencesDesignFiles from './references/_id/design-files/route';
import * as referencesNotes from './references/_id/notes/route';
import * as references from './references/_id/route';
import * as runChanges from './runs/_id/changes/route';
import * as runDefer from './runs/_id/defer/route';
import * as runInterrupt from './runs/_id/interrupt/route';
import * as runOutput from './runs/_id/output/route';
import * as runPrompt from './runs/_id/prompt/route';
import * as runs from './runs/route';
import * as seedDemo from './seed-demo/route';
import * as sidebar from './sidebar/route';
import * as skillCatalog from './skill-catalog/route';
import * as skills from './skills/route';
import * as sync from './sync/route';
import * as projectTalkRemember from './talk/remember/route';
import * as projectTalk from './talk/route';
import * as taskEvidencePins from './tasks/_id/evidence-pins/route';
import * as taskOutcome from './tasks/_id/outcome/route';
import * as taskRun from './tasks/_id/run/route';
import * as tasksArchive from './tasks/archive/route';
import * as tasksBulk from './tasks/bulk/route';
import * as tasks from './tasks/route';
import * as verificationRunArtifacts from './verification-runs/_id/artifacts/route';
import * as verificationRunFile from './verification-runs/_id/file/route';
import * as verificationRun from './verification-runs/_id/route';
import * as verificationRuns from './verification-runs/route';

/** Every route module, keyed by its name in API_ROUTES. */
const MODULES: Record<keyof typeof API_ROUTES, unknown> = {
  about,
  backends,
  backendsRescan,
  dataRoot,
  skillCatalog,
  deck,
  deckSpotCheck,
  decisionsBulk,
  designSystemWizardCreateFromTokens,
  designSystemWizardExtractBrand,
  libraryMeta,
  libraryMetaUse,
  libraryMetaBookmark,
  libraryMetaFacets,
  memory,
  memoryEntry,
  references,
  referencesRef,
  referencesDesignFiles,
  referencesDesignFile,
  referencesNotes,
  mcpServers,
  mcpServer,
  mcpHandoffPrompt,
  pty,
  ptyId,
  ptyInput,
  ptyStream,
  activityLog,
  adoptionRun,
  adoptionReview,
  adoptionRetry,
  agents,
  brainDump,
  brainDumpAutomate,
  briefs,
  checkpoints,
  checkpointsExport,
  checkpointsImport,
  checkpointsLoad,
  checkpointsNew,
  contracts,
  craftRules,
  daemon,
  dashboard,
  decisions,
  designSystemFile,
  designSystems,
  envPreflight,
  envPreflightFix,
  goals,
  inbox,
  inboxRespond,
  logs,
  notificationsTest,
  productRoot,
  projects,
  projectsAdopt,
  project,
  projectBaselines,
  projectBaseline,
  projectBrief,
  projectBriefAnswers,
  projectBriefAmend,
  projectTalk,
  projectTalkRemember,
  projectDesigns,
  projectDesign,
  projectDesignApprove,
  projectDesignAttachments,
  projectDesignCritiqueTranscript,
  projectDesignExport,
  projectDesignFiles,
  projectDesignPins,
  projectDesignPinsPreview,
  projectDesignSnapshots,
  projectDesignStream,
  projectDesignTranscript,
  projectDesignTurn,
  projectEvidencePins,
  projectHealth,
  projectProbes,
  projectPromote,
  projectPromotePreview,
  projectJourneys,
  projectJourney,
  projectJourneyRun,
  projectKnowledge,
  projectKnowledgeAppend,
  projectRun,
  runs,
  runInterrupt,
  runDefer,
  runOutput,
  runOutputStream,
  runPrompt,
  runChanges,
  seedDemo,
  sidebar,
  skills,
  sync,
  tasks,
  tasksArchive,
  tasksBulk,
  taskEvidencePins,
  taskOutcome,
  taskRun,
  verificationRuns,
  verificationRun,
  verificationRunArtifacts,
  verificationRunFile,
};

/** Segment counts a route path breaks down into, for ordering by specificity. */
export interface RouteSpecificity {
  /** `:id`-style dynamic segments — these match anything, so fewer is more specific. */
  params: number;
  /** Fixed-text segments — more is more specific. */
  literals: number;
  length: number;
}

export function routeSpecificity(routePath: string): RouteSpecificity {
  const segments = routePath.split('/').filter(Boolean);
  const params = segments.filter((s) => s.startsWith(':')).length;
  return { params, literals: segments.length - params, length: routePath.length };
}

/**
 * Express matches the first registered pattern, so a route with a param where
 * a sibling has a literal at the same position will swallow that sibling if it
 * registers first — `/api/references/:id/:refId` ahead of
 * `/api/references/:id/notes` 405'd every Notes tab (walkthrough B2) because
 * the old sort used path-string length as a specificity proxy, and the param
 * path happened to be longer. Real specificity: fewest dynamic params first,
 * then most literal segments, then (tie-break only) the longest string.
 * `route-order.test.ts` scripts every registered route through this to catch
 * the next such collision.
 */
export function bySpecificity(a: string, b: string): number {
  const sa = routeSpecificity(a);
  const sb = routeSpecificity(b);
  if (sa.params !== sb.params) return sa.params - sb.params;
  if (sa.literals !== sb.literals) return sb.literals - sa.literals;
  return sb.length - sa.length;
}

export function apiRouter(): Router {
  const router = Router();
  const names = (Object.keys(MODULES) as Array<keyof typeof API_ROUTES>).sort((a, b) =>
    bySpecificity(API_ROUTES[a], API_ROUTES[b]),
  );
  for (const name of names) {
    router.all(API_ROUTES[name], mountRoute(MODULES[name]));
  }
  return router;
}
