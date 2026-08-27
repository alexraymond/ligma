/**
 * Ligma as an MCP server (OD-064/OD-014) — a stdio entrypoint external coding
 * agents (Claude Code, etc.) can point at to drive ligma directly.
 *
 * Dependency decision: the studio provider already has an in-process MCP
 * bridge (studio/provider.ts's buildMcpServer, built on
 * @anthropic-ai/claude-agent-sdk's createSdkMcpServer), but that bridge only
 * talks to the SDK's own agent loop over an in-memory transport — it has no
 * stdio wire and cannot be attached to an arbitrary external client. Real MCP
 * stdio wire compliance (initialize handshake, capability negotiation,
 * protocol version checks) is not "a few lines to hand-roll" without risking
 * silent incompatibility with real clients, so this uses
 * @modelcontextprotocol/sdk's `McpServer` + `StdioServerTransport` — the
 * reference implementation. It was not previously a direct dependency of any
 * ligma package (only present transitively as an optional peer of
 * `@google/genai`), so it is added to apps/daemon/package.json pinned to the
 * latest stable at the time of writing (^1.30.0).
 *
 * The toolset is deliberately small and wraps EXISTING route handlers
 * in-process (imported, not reimplemented): each tool builds a `Request`,
 * hands it to the same GET/POST/PUT function the HTTP surface uses, and
 * returns the JSON response. That keeps exactly one implementation of every
 * business rule (soft-delete filtering, activity logging, undo journals, …)
 * — the MCP tool and the HTTP route can never drift apart in what they do.
 *
 * Tool inputs are validated with the existing zod schemas from
 * store/validations.ts wherever one already fits the shape (create_project,
 * answer_decision); the list tools take plain optional string filters, the
 * same way their GET routes already accept unvalidated query params.
 *
 * `create_project` is scoped to the bare project record (POST /api/projects)
 * — NOT the prompt-first discovery/brief flow (POST /api/briefs), which
 * spawns a live model turn and stays a UI-only path. An external agent gets a
 * fast, deterministic way to create a project; the guided brief experience is
 * not duplicated here.
 */
import { z } from 'zod';
import { DaemonRequest } from './http';
import * as decisionsRoute from './routes/decisions/route';
import * as projectsRoute from './routes/projects/route';
import * as runsRoute from './routes/runs/route';
import * as tasksRoute from './routes/tasks/route';
import { LIMITS, decisionUpdateSchema, projectCreateSchema } from './store/validations';

// ─── Route-handler wrapper ───────────────────────────────────────────────────

interface RouteResult {
  status: number;
  body: unknown;
}

/** Builds a Request, hands it to an existing route handler, reads the JSON back. */
async function callRoute(
  handler: (request: Request) => Response | Promise<Response>,
  url: string,
  init?: RequestInit,
): Promise<RouteResult> {
  const request = new DaemonRequest(url, init);
  const response = await handler(request);
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

const BASE = 'http://ligma-mcp.local';
const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

// ─── Tool implementations (exported for direct testing) ─────────────────────

export async function listProjectsTool(input: { status?: string }): Promise<RouteResult> {
  const url = new URL('/api/projects', BASE);
  if (input.status) url.searchParams.set('status', input.status);
  return callRoute(projectsRoute.GET, url.toString());
}

export const createProjectInputSchema = projectCreateSchema;
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;

/** Validation-failure shape, matching store/validations.ts's validateBody. */
function invalidInput(error: z.ZodError): RouteResult {
  return {
    status: 400,
    body: {
      error: 'Validation failed',
      details: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    },
  };
}

export async function createProjectTool(input: unknown): Promise<RouteResult> {
  const parsed = createProjectInputSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return callRoute(projectsRoute.POST, `${BASE}/api/projects`, jsonInit('POST', parsed.data));
}

export async function listTasksTool(input: {
  projectId?: string;
  kanban?: string;
}): Promise<RouteResult> {
  const url = new URL('/api/tasks', BASE);
  if (input.projectId) url.searchParams.set('projectId', input.projectId);
  if (input.kanban) url.searchParams.set('kanban', input.kanban);
  return callRoute(tasksRoute.GET, url.toString());
}

export async function listDecisionsTool(input: { status?: string }): Promise<RouteResult> {
  const url = new URL('/api/decisions', BASE);
  if (input.status) url.searchParams.set('status', input.status);
  return callRoute(decisionsRoute.GET, url.toString());
}

// Tightens decisionUpdateSchema's optional `answer`/`status` into what
// "answering" actually means, rather than inventing a parallel schema.
export const answerDecisionInputSchema = decisionUpdateSchema.extend({
  status: z.literal('answered').optional().default('answered'),
  answer: z.string().min(1, 'Answer is required').max(LIMITS.ANSWER),
});
export type AnswerDecisionInput = z.infer<typeof answerDecisionInputSchema>;

// Validated HERE, not just at MCP tool registration: this function is what the
// unit tests (and any future non-stdio caller) invoke directly, so the
// default status and the non-empty-answer rule must live on this path, not
// only on the JSON-schema the stdio wire happens to advertise to a client.
export async function answerDecisionTool(input: unknown): Promise<RouteResult> {
  const parsed = answerDecisionInputSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return callRoute(decisionsRoute.PUT, `${BASE}/api/decisions`, jsonInit('PUT', parsed.data));
}

export async function getRunStatusTool(input: { runId?: string }): Promise<RouteResult> {
  const result = await callRoute(runsRoute.GET, `${BASE}/api/runs`);
  if (!input.runId || result.status !== 200) return result;
  const runs = (result.body as { runs?: Array<{ id: string }> } | null)?.runs ?? [];
  const run = runs.find((r) => r.id === input.runId);
  return run ? { status: 200, body: run } : { status: 404, body: { error: 'Run not found' } };
}

// ─── stdio wire (only started when this file is run directly) ───────────────

function toolResult(result: RouteResult): {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(result.body ?? null) }],
    ...(result.status >= 400 ? { isError: true } : {}),
  };
}

// ─── Idle exit (safety net for orphaned processes) ───────────────────────────
//
// One server process is spawned per stdio client and is meant to exit when
// that client disconnects (handled below, by watching stdin). If a parent
// dies without closing the pipe cleanly, nothing ever signals us to exit and
// the process lingers — this timer is the fallback. It resets on every
// handled tool call, so it only fires once a client goes quiet.

const DEFAULT_IDLE_EXIT_MS = 30 * 60 * 1000; // 30 minutes
const MAX_IDLE_EXIT_MS = 24 * 60 * 60 * 1000; // 24 hours

/** LIGMA_MCP_IDLE_EXIT_MS: default 30min, clamped to a 24h max; 0 disables idle exit. */
export function resolveIdleExitMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.LIGMA_MCP_IDLE_EXIT_MS?.trim();
  const parsed = Number(raw);
  if (!raw || !Number.isFinite(parsed) || parsed < 0) return DEFAULT_IDLE_EXIT_MS;
  return Math.min(MAX_IDLE_EXIT_MS, Math.floor(parsed));
}

/** Resettable idle timer; idleMs <= 0 disables it. unref'd so it never keeps the process alive by itself. */
function startIdleExitTimer(idleMs: number, onIdle: () => void): { noteActivity: () => void } {
  if (idleMs <= 0) return { noteActivity: () => {} };
  let timer: NodeJS.Timeout | undefined;
  const noteActivity = () => {
    clearTimeout(timer);
    timer = setTimeout(onIdle, idleMs).unref();
  };
  noteActivity();
  return { noteActivity };
}

async function main(): Promise<void> {
  const [{ McpServer }, { StdioServerTransport }] = await Promise.all([
    import('@modelcontextprotocol/sdk/server/mcp.js'),
    import('@modelcontextprotocol/sdk/server/stdio.js'),
  ]);

  const server = new McpServer({ name: 'ligma', version: '1.0.0' });

  const idleExit = startIdleExitTimer(resolveIdleExitMs(), () => process.exit(0));
  const tracked =
    <I>(handler: (input: I) => Promise<RouteResult>) =>
    async (input: I) => {
      idleExit.noteActivity();
      return toolResult(await handler(input));
    };

  server.tool(
    'list_projects',
    'List ligma projects, optionally filtered by status (active|paused|completed|archived).',
    { status: z.string().optional() },
    tracked(listProjectsTool),
  );

  server.tool(
    'create_project',
    'Create a bare ligma project record (name/description/status/repoPath/tags). This is NOT the ' +
      'prompt-first discovery flow — that stays a UI-only path.',
    createProjectInputSchema.shape,
    tracked(createProjectTool),
  );

  server.tool(
    'list_tasks',
    'List ligma tasks, optionally filtered by projectId and/or kanban column.',
    { projectId: z.string().optional(), kanban: z.string().optional() },
    tracked(listTasksTool),
  );

  server.tool(
    'list_decisions',
    'List ligma decisions, optionally filtered by status (pending|answered).',
    { status: z.string().optional() },
    tracked(listDecisionsTool),
  );

  server.tool(
    'answer_decision',
    'Answer a pending ligma decision by id.',
    answerDecisionInputSchema.shape,
    tracked(answerDecisionTool),
  );

  server.tool(
    'get_run_status',
    'Get the status of one ligma run by id, or every run if no id is given.',
    { runId: z.string().optional() },
    tracked(getRunStatusTool),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // The SDK's StdioServerTransport only wires up 'data'/'error' listeners on
  // stdin (see its start()) — it never exits when the client disconnects, so
  // do that ourselves.
  process.stdin.once('end', () => process.exit(0));
  process.stdin.once('close', () => process.exit(0));
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(`ligma MCP server failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
