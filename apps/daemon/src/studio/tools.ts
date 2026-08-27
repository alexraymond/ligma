/**
 * The real `ToolRegistry` — the piece the studio map named as missing.
 *
 * `packages/core`'s agent loop was wired end to end for text streaming but
 * handed an EMPTY registry with `allowedTools: []`, so it never wrote a file and
 * never populated the Wall. These are the tools that make the loop actually
 * generate: write / read / list, plus the EDITMODE tweak-schema declaration.
 *
 * Every one of them is scoped to a single design's `src/` directory. The
 * scoping is the point, not a nicety — this registry is the only thing standing
 * between a generated instruction and the rest of the filesystem, so it resolves
 * and contains *before* it opens (see `resolveInsideRoot`), and it re-checks
 * after resolving symlinks so a link planted inside the tree cannot be used as a
 * door out of it.
 *
 * The tools carry no permission prompts and no policy: the loop's `Tool`
 * interface is deliberately small (name / isConcurrencySafe / run), and the
 * daemon is a single-user localhost process. Containment is the whole policy.
 */

import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CritiqueRuleScore, TweakControl, TweakSchema } from '@ligma/api';
import { type Tool, ToolRegistry, type ToolRunResult } from '@ligma/core/agent';
import { z } from 'zod';
import { resolveInsideRoot, toDesignRelative } from './paths';

/** Refuse to hold a whole design's worth of generated slop in one file. */
const MAX_FILE_BYTES = 2_000_000;

export const STUDIO_TOOL_NAMES = [
  'write_file',
  'read_file',
  'list_files',
  'declare_tweak_schema',
] as const;
export type StudioToolName = (typeof STUDIO_TOOL_NAMES)[number];

/** What the session wants to know as the agent works — drives the SSE stream. */
export interface StudioToolHooks {
  /** A file landed. One event per write; the Wall does its own throttling. */
  onFileWritten?: (relativePath: string, byteSize: number) => void;
  /** The agent declared its tweak controls. */
  onTweakSchema?: (schema: TweakSchema) => void;
  /**
   * Where this turn's `@`-mentioned skills were staged (`skill-staging.ts`).
   * Set only when the turn staged some, and it buys exactly one extra tool:
   * a read scoped to that directory. The staging tree is *not* reachable
   * through `read_file`, which stays scoped to the design source.
   */
  stagedSkillsRoot?: string;
}

function fail(message: string): ToolRunResult {
  return { ok: false, error: message };
}

/**
 * Resolve `relativePath` under `root`, containing it both before and after
 * symlink resolution.
 *
 * The second check is the one that is easy to forget: `resolveInsideRoot` proves
 * the *lexical* path is inside, but if `src/theme` is a symlink to `/etc`, the
 * lexical path is innocent and the write is not. For a file that does not exist
 * yet we realpath the nearest existing ancestor instead, since realpath on a
 * missing leaf throws.
 */
async function resolveContained(root: string, relativePath: string): Promise<string> {
  const target = resolveInsideRoot(root, relativePath);
  const rootReal = await realpath(root);

  let probe = target;
  for (;;) {
    try {
      const real = await realpath(probe);
      if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
        throw new Error(`path "${relativePath}" resolves outside the design directory`);
      }
      return target;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      const parent = path.dirname(probe);
      // Walked all the way up without finding anything real: the lexical check
      // already proved containment, so there is nothing left to verify.
      if (parent === probe) return target;
      probe = parent;
    }
  }
}

function asRecord(input: unknown): Record<string, unknown> {
  return input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {};
}

function requireString(input: unknown, field: string): string {
  const value = asRecord(input)[field];
  if (typeof value !== 'string') throw new Error(`\`${field}\` must be a string`);
  return value;
}

// ─── Tweak schema validation ─────────────────────────────────────────────────

const TWEAK_KINDS = new Set(['color', 'number', 'enum', 'boolean', 'string']);

/**
 * Validate the agent-declared tweak schema.
 *
 * Structured in, structured out: the agent declares this as JSON through a tool
 * call, so there is nothing to parse out of prose (build brief §8). Anything
 * malformed is rejected with a reason the model can act on rather than
 * best-effort coerced — a half-understood control renders a slider on a colour.
 */
export function parseTweakSchema(input: unknown): TweakSchema {
  const raw = asRecord(asRecord(input).schema);
  if (Object.keys(raw).length === 0)
    throw new Error('`schema` must be a non-empty object of token → control');

  const schema: TweakSchema = {};
  for (const [token, value] of Object.entries(raw)) {
    const control = asRecord(value);
    const kind = control.kind;
    if (typeof kind !== 'string' || !TWEAK_KINDS.has(kind)) {
      throw new Error(`token "${token}": \`kind\` must be one of ${[...TWEAK_KINDS].join(', ')}`);
    }
    const out: TweakControl = {
      kind: kind as TweakControl['kind'],
      // Undeclared means "safe to swap in place": these are token values, and a
      // token that needs a rebuild is the exception the agent must announce.
      live: control.live !== false,
    };
    if (typeof control.min === 'number') out.min = control.min;
    if (typeof control.max === 'number') out.max = control.max;
    if (typeof control.step === 'number') out.step = control.step;
    if (typeof control.unit === 'string') out.unit = control.unit;
    if (typeof control.placeholder === 'string') out.placeholder = control.placeholder;
    if (Array.isArray(control.options))
      out.options = control.options.filter((o): o is string => typeof o === 'string');
    if (out.kind === 'enum' && (out.options === undefined || out.options.length === 0)) {
      throw new Error(`token "${token}": an enum control needs a non-empty \`options\` list`);
    }
    schema[token] = out;
  }
  return schema;
}

// ─── The registry ────────────────────────────────────────────────────────────

/**
 * Build the tool registry for one design session.
 *
 * `root` is the design's `src/` directory and nothing above it is reachable —
 * not `design.json`, not `blobs/`, not the rest of `data/`.
 */
export function createDesignToolRegistry(root: string, hooks: StudioToolHooks = {}): ToolRegistry {
  const registry = new ToolRegistry();

  const writeFileTool: Tool = {
    name: 'write_file',
    // Two writes to the same path in one batch must not interleave, and the
    // agent has no way to promise they won't target the same file.
    isConcurrencySafe: () => false,
    async run(input): Promise<ToolRunResult> {
      try {
        const relativePath = requireString(input, 'path');
        const content = requireString(input, 'content');
        const bytes = Buffer.byteLength(content, 'utf-8');
        if (bytes > MAX_FILE_BYTES) {
          return fail(
            `content is ${bytes} bytes — the ${MAX_FILE_BYTES}-byte per-file limit exists to catch runaway output`,
          );
        }
        const target = await resolveContained(root, relativePath);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, content, 'utf-8');
        const normalised = toDesignRelative(root, target);
        hooks.onFileWritten?.(normalised, bytes);
        return { ok: true, result: `wrote ${normalised} (${bytes} bytes)` };
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  const readFileTool: Tool = {
    name: 'read_file',
    isConcurrencySafe: () => true,
    async run(input): Promise<ToolRunResult> {
      try {
        const relativePath = requireString(input, 'path');
        const target = await resolveContained(root, relativePath);
        return { ok: true, result: await readFile(target, 'utf-8') };
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  const listFilesTool: Tool = {
    name: 'list_files',
    isConcurrencySafe: () => true,
    async run(input): Promise<ToolRunResult> {
      try {
        const sub = asRecord(input).path;
        const target =
          typeof sub === 'string' && sub !== '' ? await resolveContained(root, sub) : root;
        const out: string[] = [];
        const visit = async (dir: string): Promise<void> => {
          for (const entry of await readdir(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) await visit(full);
            else if (entry.isFile()) out.push(toDesignRelative(root, full));
          }
        };
        try {
          await visit(target);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        }
        return { ok: true, result: out.sort() };
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  const declareTweakSchemaTool: Tool = {
    name: 'declare_tweak_schema',
    isConcurrencySafe: () => false,
    async run(input): Promise<ToolRunResult> {
      try {
        const schema = parseTweakSchema(input);
        hooks.onTweakSchema?.(schema);
        return { ok: true, result: `declared ${Object.keys(schema).length} tweak controls` };
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  for (const tool of [writeFileTool, readFileTool, listFilesTool, declareTweakSchemaTool]) {
    registry.register(tool);
  }

  // Read-only, and only when this turn staged something to read. The same
  // contain-then-open discipline as the source tools, against a second root.
  const stagedRoot = hooks.stagedSkillsRoot;
  if (stagedRoot) {
    registry.register({
      name: 'read_staged_skill',
      isConcurrencySafe: () => true,
      async run(input): Promise<ToolRunResult> {
        try {
          const relativePath = requireString(input, 'path');
          return {
            ok: true,
            result: await readFile(await resolveContained(stagedRoot, relativePath), 'utf-8'),
          };
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err));
        }
      },
    });
  }

  return registry;
}

// ─── The critic's registry ───────────────────────────────────────────────────

/**
 * A structured critique, submitted by the critic as a tool call.
 *
 * This is the anti-regex rule (build brief §8) made structural: the critic never
 * writes a score in prose for us to fish out — it *calls a tool* with typed
 * fields, and a call that does not validate produces no score at all. There is
 * no "best effort" reading of a critic's paragraph, because a misread score is
 * indistinguishable from a real one.
 */
export interface SubmittedCritique {
  score: number;
  rules: CritiqueRuleScore[];
}

export function parseCritiqueSubmission(input: unknown): SubmittedCritique {
  const raw = asRecord(input);
  const score = raw.score;
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error('`score` must be a number between 0 and 100');
  }
  if (!Array.isArray(raw.rules) || raw.rules.length === 0) {
    throw new Error('`rules` must be a non-empty list of { rule, score, note }');
  }
  const rules: CritiqueRuleScore[] = raw.rules.map((entry, i) => {
    const item = asRecord(entry);
    if (typeof item.rule !== 'string' || item.rule === '')
      throw new Error(`rules[${i}]: \`rule\` must be a string`);
    if (
      typeof item.score !== 'number' ||
      !Number.isFinite(item.score) ||
      item.score < 0 ||
      item.score > 100
    ) {
      throw new Error(`rules[${i}]: \`score\` must be a number between 0 and 100`);
    }
    return {
      rule: item.rule,
      score: item.score,
      note: typeof item.note === 'string' ? item.note : '',
    };
  });
  return { score, rules };
}

/**
 * Read-only tools plus `submit_critique`.
 *
 * The critic cannot write: it grades an artifact, and a grader that can edit
 * what it grades is the "builder grades itself" failure in a different costume
 * (build brief §4 principle 1).
 */
export function createCriticToolRegistry(
  root: string,
  onVerdict: (verdict: SubmittedCritique) => void,
): ToolRegistry {
  const registry = new ToolRegistry();
  const readOnly = createDesignToolRegistry(root);
  registry.register(requireTool(readOnly, 'read_file'));
  registry.register(requireTool(readOnly, 'list_files'));
  registry.register({
    name: 'submit_critique',
    isConcurrencySafe: () => false,
    async run(input): Promise<ToolRunResult> {
      try {
        onVerdict(parseCritiqueSubmission(input));
        return { ok: true, result: 'critique recorded' };
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  });
  return registry;
}

// ─── The promote planner's registry ──────────────────────────────────────────

/** A task breakdown, submitted structurally rather than written in prose. */
export interface SubmittedPlan {
  tasks: Array<{
    /** The planner's own handle, `t1..tN` — what `dependsOn` references. */
    id: string;
    title: string;
    description: string;
    acceptanceCriteria: string[];
    dependsOn: string[];
    designFilePaths: string[];
    /** How uncertain this task is. Drives urgency at commit. */
    risk: 'low' | 'high';
  }>;
  invariants: string[];
  journeys: Array<{ title: string; goal: string; steps: string[] }>;
  /**
   * A short name for the project itself (<=60 chars), distinct from any task
   * title. Optional and additive — older callers/fixtures with no `title`
   * still parse. The composer's kickoff names a project from the first line
   * of the raw prompt when the user leaves the name blank; this is the first
   * point an LLM has actually read the brief, so it is where a real name is
   * allowed to replace that placeholder (never a human-typed one — see
   * `Project.nameIsPlaceholder`).
   */
  title?: string;
}

/** The planner's own task handle. Same vocabulary `dependsOn` speaks. */
const PLANNER_ID = /^t\d+$/;

/**
 * The first dependency cycle in `edges`, as the ids that make it up, or null.
 *
 * Plain iterative-free DFS with a colour map — a plan is a dozen tasks, so the
 * lazy recursive walk is the right one and the stack cannot get deep enough to
 * matter.
 */
function findCycle(edges: Map<string, string[]>): string[] | null {
  const done = new Set<string>();
  const stack: string[] = [];

  const walk = (id: string): string[] | null => {
    const seen = stack.indexOf(id);
    if (seen !== -1) return stack.slice(seen);
    if (done.has(id)) return null;
    stack.push(id);
    for (const next of edges.get(id) ?? []) {
      const cycle = walk(next);
      if (cycle) return cycle;
    }
    stack.pop();
    done.add(id);
    return null;
  };

  for (const id of edges.keys()) {
    const cycle = walk(id);
    if (cycle) return cycle;
  }
  return null;
}

/**
 * Validate a submitted promotion plan.
 *
 * The Promote sheet is the last human checkpoint before the oracle freezes, so
 * everything it shows must come from typed fields the planner filled in — never
 * from a paragraph this daemon then reads with a regex (build brief §8, and
 * Alex's standing rule against pattern-matching structure out of free text).
 *
 * Dependencies are validated, never repaired. Until execution-flow-review H1 the
 * planner had no ids at all and promote dropped every unresolvable dep with a
 * silent `.filter`, so a plan that said "write-up after build" landed as two
 * unordered tasks and nobody was told. A plan whose structure cannot be honored
 * is refused here — the tool call fails, the model sees why, and it can submit
 * again — because a quietly flattened graph is the failure that hides.
 *
 * `id` and `risk` are read leniently when absent (positional `t1..tN`, `low`):
 * the tool schema requires both, but a plan fixture or an in-flight preview
 * written before they existed must still parse rather than fail a promotion.
 */
export function parsePromotionPlan(input: unknown): SubmittedPlan {
  const raw = asRecord(input);
  if (!Array.isArray(raw.tasks) || raw.tasks.length === 0) {
    throw new Error('`tasks` must be a non-empty list');
  }
  const tasks = raw.tasks.map((entry, i) => {
    const task = asRecord(entry);
    if (typeof task.title !== 'string' || task.title.trim() === '')
      throw new Error(`tasks[${i}]: \`title\` is required`);
    const criteria = Array.isArray(task.acceptanceCriteria)
      ? task.acceptanceCriteria.filter((c): c is string => typeof c === 'string' && c.trim() !== '')
      : [];
    if (criteria.length === 0) {
      // A task with no criteria compiles to a contract with no oracle, which is
      // how "done" quietly becomes "the builder said so".
      throw new Error(
        `tasks[${i}] ("${task.title}"): at least one acceptance criterion is required`,
      );
    }
    const id = task.id === undefined ? `t${i + 1}` : task.id;
    if (typeof id !== 'string' || !PLANNER_ID.test(id)) {
      throw new Error(
        `tasks[${i}] ("${task.title}"): \`id\` must look like "t1", not ${JSON.stringify(task.id)}`,
      );
    }
    if (task.risk !== undefined && task.risk !== 'low' && task.risk !== 'high') {
      throw new Error(
        `tasks[${i}] ("${task.title}"): \`risk\` must be "low" or "high", not ${JSON.stringify(task.risk)}`,
      );
    }
    const risk: 'low' | 'high' = task.risk === 'high' ? 'high' : 'low';
    return {
      id,
      title: task.title,
      description: typeof task.description === 'string' ? task.description : '',
      acceptanceCriteria: criteria,
      dependsOn: Array.isArray(task.dependsOn)
        ? task.dependsOn.filter((d): d is string => typeof d === 'string')
        : [],
      designFilePaths: Array.isArray(task.designFilePaths)
        ? task.designFilePaths.filter((d): d is string => typeof d === 'string')
        : [],
      risk,
    };
  });

  const edges = new Map<string, string[]>();
  for (const task of tasks) {
    if (edges.has(task.id)) {
      throw new Error(
        `two tasks claim the id "${task.id}" — each task needs its own, and \`dependsOn\` keys off them`,
      );
    }
    edges.set(task.id, task.dependsOn);
  }
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      if (!edges.has(dep)) {
        throw new Error(
          `task "${task.id}" depends on "${dep}", which no task in this plan declares`,
        );
      }
    }
  }
  const cycle = findCycle(edges);
  if (cycle) {
    throw new Error(
      `\`dependsOn\` forms a cycle: ${[...cycle, cycle[0]].join(' → ')} — nothing in it could ever start`,
    );
  }

  const journeys = Array.isArray(raw.journeys)
    ? raw.journeys.flatMap((entry) => {
        const journey = asRecord(entry);
        if (typeof journey.title !== 'string' || typeof journey.goal !== 'string') return [];
        return [
          {
            title: journey.title,
            goal: journey.goal,
            steps: Array.isArray(journey.steps)
              ? journey.steps.filter((s): s is string => typeof s === 'string')
              : [],
          },
        ];
      })
    : [];

  // Never regex/keyword-extract a title out of the brief — this is the LLM's
  // own structured field. Truncated defensively rather than rejected: an
  // oversized title is not worth failing an otherwise-good plan over.
  const rawTitle = typeof raw.title === 'string' ? raw.title.trim() : '';
  const title = rawTitle === '' ? undefined : rawTitle.slice(0, 60);

  return {
    tasks,
    invariants: Array.isArray(raw.invariants)
      ? raw.invariants.filter((i): i is string => typeof i === 'string' && i.trim() !== '')
      : [],
    journeys,
    ...(title !== undefined ? { title } : {}),
  };
}

/** Read-only over the design (when there is one) plus `submit_plan`. */
export function createPlannerToolRegistry(
  root: string | null,
  onPlan: (plan: SubmittedPlan) => void,
): ToolRegistry {
  const registry = new ToolRegistry();
  if (root !== null) {
    const readOnly = createDesignToolRegistry(root);
    registry.register(requireTool(readOnly, 'read_file'));
    registry.register(requireTool(readOnly, 'list_files'));
  }
  registry.register({
    name: 'submit_plan',
    isConcurrencySafe: () => false,
    async run(input): Promise<ToolRunResult> {
      try {
        onPlan(parsePromotionPlan(input));
        return { ok: true, result: 'plan recorded' };
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  });
  return registry;
}

// ─── Declarations for the provider bridge ────────────────────────────────────

/**
 * Description + argument shape per tool, so a provider can declare whatever
 * registry it is handed without knowing which one it is.
 *
 * The zod shapes live here rather than in the provider because they describe
 * the tools, and a schema that drifts from its implementation is worse than no
 * schema — keeping both in one file is what stops that.
 */
export const STUDIO_TOOL_DECLARATIONS: Record<
  string,
  { description: string; shape: Record<string, z.ZodTypeAny> }
> = {
  write_file: {
    description:
      'Create or overwrite one file of the design source. Path is relative to the design root.',
    shape: { path: z.string(), content: z.string() },
  },
  read_file: {
    description: 'Read one file of the design source.',
    shape: { path: z.string() },
  },
  list_files: {
    description: 'List the design source files, optionally under a subdirectory.',
    shape: { path: z.string().optional() },
  },
  read_staged_skill: {
    description:
      'Read one file of a skill staged for this turn — the instruction named it with @. Path is `<skill-id>/<file>`, e.g. `brainstorming/SKILL.md`; the exact paths available are listed in the instruction. This is reference material copied for this turn, not design source: read it, never write it back.',
    shape: { path: z.string() },
  },
  declare_tweak_schema: {
    description:
      'Declare the control each EDITMODE token gets: kind (color|number|enum|boolean|string), optional min/max/step/unit/options, and `live: false` when a change needs regeneration.',
    shape: { schema: z.record(z.string(), z.unknown()) },
  },
  submit_critique: {
    description:
      'Submit the critique. `score` is 0-100 overall; `rules` is one entry per rule you assessed, each { rule, score, note }. Call this exactly once, last.',
    shape: {
      score: z.number(),
      rules: z.array(
        z.object({ rule: z.string(), score: z.number(), note: z.string().optional() }),
      ),
    },
  },
  submit_plan: {
    description:
      'Submit the build plan. `tasks` is the breakdown. Give every task its own `id` — "t1", "t2", … unique within this plan — and use those ids in `dependsOn` to declare what must land first: `{ id: "t2", dependsOn: ["t1"] }` means t2 cannot start until t1 is done. Reference an id no task declares, reuse an id, or form a cycle and the plan is rejected. Each task also needs a title, description, acceptanceCriteria (user-observable, at least one) and `risk`: "high" when the work is uncertain, novel, or blocks several other tasks; "low" when it is routine. `invariants` are things the product must NEVER do. `journeys` are goal-oriented user journeys. `title` is an optional short name (<=60 chars) for the project itself, not a task — a plain noun phrase naming what is being built. Call this exactly once, last.',
    shape: {
      tasks: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          description: z.string().optional(),
          acceptanceCriteria: z.array(z.string()),
          risk: z.enum(['low', 'high']),
          dependsOn: z.array(z.string()).optional(),
          designFilePaths: z.array(z.string()).optional(),
        }),
      ),
      invariants: z.array(z.string()).optional(),
      journeys: z
        .array(z.object({ title: z.string(), goal: z.string(), steps: z.array(z.string()) }))
        .optional(),
      title: z.string().max(60).optional(),
    },
  },
};

/** Non-null assertion-free lookup used by the provider bridge. */
export function requireTool(registry: ToolRegistry, name: string): Tool {
  const tool = registry.get(name);
  if (!tool) throw new Error(`Studio tool "${name}" is not registered`);
  return tool;
}

export function requireDeclaration(name: string): {
  description: string;
  shape: Record<string, z.ZodTypeAny>;
} {
  const declaration = STUDIO_TOOL_DECLARATIONS[name];
  if (!declaration) throw new Error(`Studio tool "${name}" has no declaration`);
  return declaration;
}
