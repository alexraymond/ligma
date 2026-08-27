/**
 * The daemon's HTTP surface, named once.
 *
 * Paths are Express-style (`:id`); every face (web proxy, CLI, tests) builds
 * URLs from here so a path can never drift between producer and consumer.
 * Params are interpolated with `apiPath`.
 */

export const API_ROUTES = {
  about: '/api/about',
  dataRoot: '/api/data-root',
  backends: '/api/backends',
  designSystemWizardCreateFromTokens: '/api/design-systems/wizard/create-from-tokens',
  designSystemWizardExtractBrand: '/api/design-systems/wizard/extract-brand',
  libraryMeta: '/api/library-meta',
  libraryMetaUse: '/api/library-meta/use',
  libraryMetaBookmark: '/api/library-meta/bookmark',
  libraryMetaFacets: '/api/library-meta/facets',
  memory: '/api/memory/:agentId',
  memoryEntry: '/api/memory/:agentId/:entryId',
  references: '/api/references/:id',
  referencesRef: '/api/references/:id/:refId',
  referencesDesignFiles: '/api/references/:id/design-files',
  referencesDesignFile: '/api/references/:id/design-files/:fileId',
  referencesNotes: '/api/references/:id/notes',
  mcpServers: '/api/mcp/servers',
  mcpServer: '/api/mcp/servers/:id',
  mcpHandoffPrompt: '/api/mcp/handoff-prompt/:id',
  pty: '/api/pty',
  ptyId: '/api/pty/:id',
  ptyInput: '/api/pty/:id/input',
  ptyStream: '/api/pty/:id/stream',
  backendsRescan: '/api/backends/rescan',
  activityLog: '/api/activity-log',
  adoptionRun: '/api/adoption/:runId',
  adoptionReview: '/api/adoption/:runId/review',
  adoptionRetry: '/api/adoption/:runId/retry',
  agents: '/api/agents',
  brainDump: '/api/brain-dump',
  brainDumpAutomate: '/api/brain-dump/automate',
  briefs: '/api/briefs',
  checkpoints: '/api/checkpoints',
  checkpointsExport: '/api/checkpoints/export',
  checkpointsImport: '/api/checkpoints/import',
  checkpointsLoad: '/api/checkpoints/load',
  checkpointsNew: '/api/checkpoints/new',
  contracts: '/api/contracts/:scope',
  craftRules: '/api/craft-rules',
  daemon: '/api/daemon',
  dashboard: '/api/dashboard',
  deck: '/api/deck',
  deckSpotCheck: '/api/deck/spot-check',
  decisions: '/api/decisions',
  decisionsBulk: '/api/decisions/bulk',
  designSystems: '/api/design-systems',
  designSystemFile: '/api/design-systems/:id/file',
  envPreflight: '/api/env-preflight',
  envPreflightFix: '/api/env-preflight/fix',
  goals: '/api/goals',
  inbox: '/api/inbox',
  inboxRespond: '/api/inbox/respond',
  logs: '/api/logs',
  notificationsTest: '/api/notifications/test',
  productRoot: '/api/product-root',
  projects: '/api/projects',
  projectsAdopt: '/api/projects/adopt',
  project: '/api/projects/:id',
  projectBaselines: '/api/projects/:id/baselines',
  projectBaseline: '/api/projects/:id/baselines/:jid',
  projectBrief: '/api/projects/:id/brief',
  projectBriefAnswers: '/api/projects/:id/brief/answers',
  projectBriefAmend: '/api/projects/:id/brief/amend',
  projectTalk: '/api/projects/:id/talk',
  projectTalkRemember: '/api/projects/:id/talk/remember',
  projectDesigns: '/api/projects/:id/designs',
  projectDesign: '/api/projects/:id/designs/:did',
  projectDesignApprove: '/api/projects/:id/designs/:did/approve',
  projectDesignAttachments: '/api/projects/:id/designs/:did/attachments',
  projectDesignCritiqueTranscript: '/api/projects/:id/designs/:did/critique-transcript',
  projectDesignExport: '/api/projects/:id/designs/:did/export',
  projectDesignFiles: '/api/projects/:id/designs/:did/files',
  projectDesignPins: '/api/projects/:id/designs/:did/pins',
  projectDesignPinsPreview: '/api/projects/:id/designs/:did/pins/preview',
  projectDesignSnapshots: '/api/projects/:id/designs/:did/snapshots',
  projectDesignStream: '/api/projects/:id/designs/:did/stream',
  projectDesignTranscript: '/api/projects/:id/designs/:did/transcript',
  projectDesignTurn: '/api/projects/:id/designs/:did/turn',
  projectEvidencePins: '/api/projects/:id/evidence-pins',
  projectHealth: '/api/projects/:id/health',
  projectProbes: '/api/projects/:id/probes',
  projectJourneys: '/api/projects/:id/journeys',
  projectJourney: '/api/projects/:id/journeys/:jid',
  projectJourneyRun: '/api/projects/:id/journeys/:jid/run',
  projectKnowledge: '/api/projects/:id/knowledge',
  projectKnowledgeAppend: '/api/projects/:id/knowledge/append',
  projectPromote: '/api/projects/:id/promote',
  projectPromotePreview: '/api/projects/:id/promote/preview',
  projectRun: '/api/projects/:id/run',
  runs: '/api/runs',
  runInterrupt: '/api/runs/:id/interrupt',
  runDefer: '/api/runs/:id/defer',
  runOutput: '/api/runs/:id/output',
  runOutputStream: '/api/runs/:id/output/stream',
  runPrompt: '/api/runs/:id/prompt',
  runChanges: '/api/runs/:id/changes',
  seedDemo: '/api/seed-demo',
  sidebar: '/api/sidebar',
  // The literal "/api/skills" is already taken by the pre-existing
  // user-authored SkillDefinition library (apps/daemon/src/routes/skills) —
  // this is the vendored `skills/` catalog (OD-077), named to avoid colliding.
  skillCatalog: '/api/skill-catalog',
  skills: '/api/skills',
  sync: '/api/sync',
  tasks: '/api/tasks',
  tasksArchive: '/api/tasks/archive',
  tasksBulk: '/api/tasks/bulk',
  taskEvidencePins: '/api/tasks/:id/evidence-pins',
  taskOutcome: '/api/tasks/:id/outcome',
  taskRun: '/api/tasks/:id/run',
  verificationRuns: '/api/verification-runs',
  verificationRun: '/api/verification-runs/:id',
  verificationRunArtifacts: '/api/verification-runs/:id/artifacts',
  verificationRunFile: '/api/verification-runs/:id/file',
} as const;

export type ApiRouteName = keyof typeof API_ROUTES;

/** Default daemon origin — override with LIGMA_DAEMON_PORT / NEXT_PUBLIC_LIGMA_DAEMON_URL. */
export const DEFAULT_DAEMON_PORT = 4477;
export const DEFAULT_DAEMON_URL = `http://127.0.0.1:${DEFAULT_DAEMON_PORT}`;

/** Fill `:param` placeholders: apiPath("runOutput", { id }) → "/api/runs/r_1/output". */
export function apiPath(name: ApiRouteName, params: Record<string, string> = {}): string {
  return API_ROUTES[name].replace(/:(\w+)/g, (_match, key: string) => {
    const value = params[key];
    if (value === undefined) throw new Error(`apiPath(${name}): missing param "${key}"`);
    return encodeURIComponent(value);
  });
}
