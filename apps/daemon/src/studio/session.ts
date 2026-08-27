/**
 * A design turn, end to end.
 *
 * This is where the pieces meet: the governor gate, the scoped tool registry,
 * `packages/core`'s agent loop, the content-addressed rail, the SSE stream, and
 * the critique pass. One entry point (`startTurn`) serves all three turn kinds
 * because the API has one turn endpoint — the kind discriminates the *prompt*,
 * not the machinery.
 *
 * Turns run detached from the request that started them: `startTurn` returns as
 * soon as the turn is accepted, and everything after that is observed through
 * `GET .../designs/:did/stream`. A multi-file generation takes minutes; holding
 * an HTTP request open for it would make the Wall's progressive render
 * impossible and any proxy timeout fatal.
 *
 * Governor discipline (build brief §4 principle 9): every generation turn and
 * every critique pass claims a slot before it spawns. The one exception is a
 * turn that does not spawn at all — a live tweak is a value substitution
 * performed by this process, and charging the quota window for work no model
 * did would make the gauge lie in the other direction.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DESIGN_SSE_EVENTS,
  type DesignAttachment,
  type DesignManifest,
  type DesignTurnAccepted,
  type DesignTurnRequest,
  type DesignVersion,
  type TweakValues,
} from '@ligma/api';
import { runTurn } from '@ligma/core/agent';
import { parseEditmodeBlock, replaceEditmodeBlock } from '@ligma/shared';
import { logger } from '../engine/logger';
import { GovernorAbort } from '../engine/quota-governor';
import { awaitClaimedSlot } from '../harness/spawn-slot';
import { REPO_ROOT } from '../paths';
import { generateId } from '../store/ids';
import { listAttachments, readAttachmentBase64, resolveAttachments } from './attachments';
import { craftContext } from './craft';
import { runCritiquePass } from './critic';
import { designSystemContext } from './design-system-context';
import { emitStudio } from './events';
import { LAYOUT_PRIMITIVES } from './layout';
import { sourceDir } from './paths';
import { compilePinInstruction } from './prompt';
import { getStudioProvider } from './provider';
import {
  parseSkillMentions,
  skillStagingPromptLine,
  stageSkills,
  stagedSkillsDir,
} from './skill-staging';
import { latestVersion, mutateManifest, readManifest, recordVersion, setStatus } from './store';
import { createDesignToolRegistry } from './tools';
import { type TurnRecorder, createTurnRecorder } from './turn-transcript';

const GENERATION_MODEL = process.env.LIGMA_STUDIO_MODEL ?? 'claude-sonnet-4-5';

/** In-flight turns, so the Wall's stop button and the critique interrupt work. */
const inFlight = new Map<string, AbortController>();

export function abortTurn(designId: string): boolean {
  const controller = inFlight.get(designId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export function isTurnInFlight(designId: string): boolean {
  return inFlight.has(designId);
}

// ─── Prompt construction ─────────────────────────────────────────────────────

async function systemPromptFor(manifest: DesignManifest): Promise<string> {
  const lines = [
    'You are the studio designer. You produce a runnable multi-file design source.',
    '',
    'Tools: `list_files` and `read_file` to see what exists, `write_file` to create or replace a file.',
    'Write real files — never describe what you would write. Every path is relative to the design root;',
    'anything outside it is refused, so do not try.',
    '',
    'Emit each screen as its own file so the Wall can render them side by side.',
    'When you use design tokens, put them in a `/*EDITMODE-BEGIN*/{...}/*EDITMODE-END*/` block and then call',
    '`declare_tweak_schema` to say what control each token gets — that is what makes the tweaks panel work.',
    // Above the design-system brief: this says how a screen *stacks*, the brief
    // says how it *looks*, and the brief has to be able to win — which it does,
    // the sheet being zero-specificity.
    LAYOUT_PRIMITIVES,
  ];

  if (manifest.designSystem) {
    try {
      const design = await readFile(
        path.join(REPO_ROOT, 'design-systems', manifest.designSystem, 'DESIGN.md'),
        'utf-8',
      );
      lines.push(
        '',
        `Design system: ${manifest.designSystem}. Follow it.`,
        '',
        design.slice(0, 8000),
      );
    } catch {
      lines.push(
        '',
        `Design system "${manifest.designSystem}" is selected but its DESIGN.md could not be read.`,
      );
    }

    // Beyond the DESIGN.md brief above: the same package's tokens.css,
    // USAGE.md read order, component inventory and design-tokens.json
    // (Phase 4, studio-od-parity-roadmap.md). "" when the package ships none
    // of these — the DESIGN.md-only prompt above is untouched either way.
    const depth = await designSystemContext(manifest.designSystem);
    if (depth) lines.push(depth);
  }

  // Craft rules go *below* the design-system brief and above the instruction —
  // open-design's own order (`craft/README.md`): the brand says what this looks
  // like, craft says what competent looks like regardless. Before this the
  // critic scored against rules the generator had never been shown (D7 OD-081).
  const craft = await craftContext(manifest.designSystem);
  if (craft) lines.push(craft);

  return lines.join('\n');
}

/**
 * The user-visible instruction for a turn.
 *
 * A comment-apply turn compiles through exactly the same function the
 * apply-preview endpoint calls, which is the point of F4: the preview is not a
 * rendering of the payload, it *is* the payload.
 */
function promptFor(
  manifest: DesignManifest,
  request: DesignTurnRequest,
): { prompt: string; pinIds: string[] } {
  if (request.kind === 'comment-apply') {
    const staged = manifest.pins.filter(
      (pin) =>
        pin.status === 'pending' &&
        (request.pinIds === undefined || request.pinIds.includes(pin.id)),
    );
    return {
      prompt: compilePinInstruction(request.prompt ?? '', staged),
      pinIds: staged.map((p) => p.id),
    };
  }
  if (request.kind === 'prompt') {
    const scope =
      request.filePaths && request.filePaths.length > 0
        ? `\n\nApply this to these files only: ${request.filePaths.join(', ')}.`
        : '';
    return { prompt: `${request.prompt}${scope}`, pinIds: [] };
  }
  const values = Object.entries(request.values)
    .map(([token, value]) => `- ${token}: ${JSON.stringify(value)}`)
    .join('\n');
  return {
    prompt: `Update the design's tokens to these values and adjust anything that depends on them:\n${values}`,
    pinIds: [],
  };
}

/**
 * What the transcript shows as the user's message.
 *
 * Deliberately not the compiled instruction a comment-apply turn transmits —
 * that is the apply-preview's job (F4), and pasting a 4KB edit block into the
 * conversation would bury the words the human actually typed. What the human
 * did is what the conversation records.
 */
function userText(request: DesignTurnRequest): string {
  if (request.kind === 'prompt') return request.prompt;
  if (request.kind === 'comment-apply') {
    const typed = request.prompt?.trim();
    const count = request.pinIds?.length;
    return typed && typed !== '' ? typed : `Apply ${count ?? 'the'} pinned edit(s)`;
  }
  return Object.entries(request.values)
    .map(([token, value]) => `${token} → ${JSON.stringify(value)}`)
    .join(', ');
}

// ─── Live tweaks (no spawn) ──────────────────────────────────────────────────

/** True when every touched token is declared `live` — substitution suffices. */
export function tweaksAreLive(manifest: DesignManifest, values: TweakValues): boolean {
  const schema = manifest.tweaks;
  if (!schema) return false;
  return Object.keys(values).every((token) => schema[token]?.live === true);
}

/**
 * Substitute token values straight into the EDITMODE block of every source file
 * that has one, reusing `@ligma/shared`'s parser rather than a second regex.
 */
async function applyLiveTweaks(manifest: DesignManifest, values: TweakValues): Promise<number> {
  const source = sourceDir(manifest.projectId, manifest.id);
  const version = latestVersion(manifest);
  let changed = 0;
  for (const file of version?.files ?? []) {
    const target = path.join(source, ...file.path.split('/'));
    const body = await readFile(target, 'utf-8').catch(() => null);
    if (body === null) continue;
    const block = parseEditmodeBlock(body);
    if (!block) continue;
    const merged = { ...(block.tokens as Record<string, unknown>), ...values };
    await writeFile(target, replaceEditmodeBlock(body, merged), 'utf-8');
    changed += 1;
  }
  return changed;
}

// ─── The turn ────────────────────────────────────────────────────────────────

export async function startTurn(
  projectId: string,
  designId: string,
  request: DesignTurnRequest,
): Promise<DesignTurnAccepted> {
  const manifest = await readManifest(projectId, designId);
  if (!manifest) throw new Error(`Design not found: ${designId}`);
  if (inFlight.has(designId)) throw new Error(`Design ${designId} already has a turn in flight`);

  // Resolved before the transcript opens: an unknown attachment id refuses the
  // turn (`attachments.ts`), and a refused turn must not leave a user message
  // behind claiming it was asked for.
  const attachments =
    request.kind === 'prompt' && request.attachmentIds && request.attachmentIds.length > 0
      ? resolveAttachments(await listAttachments(projectId, designId), request.attachmentIds)
      : [];

  const turnId = generateId('dt');
  // The user's message opens the transcript before anything else can fail —
  // a turn the governor defers still shows what was asked for.
  const recorder = createTurnRecorder(projectId, designId, turnId);
  await recorder.user(userText(request));
  await recorder.attachments(attachments.map((attachment) => attachment.name));

  // A live tweak never reaches a model: it is a value swap this process can do
  // itself, so it takes no governor slot and lands synchronously.
  if (request.kind === 'tweak' && tweaksAreLive(manifest, request.values)) {
    const version = await mutateManifest(projectId, designId, async (current) => {
      const files = await applyLiveTweaks(current, request.values);
      current.tweakValues = { ...current.tweakValues, ...request.values };
      const recorded =
        files > 0
          ? await recordVersion(
              current,
              'tweak',
              `tweaked ${Object.keys(request.values).length} token(s)`,
            )
          : null;
      return recorded;
    });
    if (version) emitSnapshot(designId, turnId, version);
    await recorder.finish('stop', null, version?.files.map((f) => f.path) ?? []);
    emitStudio(designId, DESIGN_SSE_EVENTS.turnDone, {
      designId,
      turnId,
      stopReason: 'stop',
      filesWritten: version?.files.length ?? 0,
      versionId: version?.id ?? null,
      error: null,
    });
    return {
      designId,
      turnId,
      kind: request.kind,
      appliedWithoutSpawn: true,
      versionId: version?.id ?? null,
    };
  }

  const controller = new AbortController();
  inFlight.set(designId, controller);
  // Detached on purpose — the caller gets the turn id, the stream gets the work.
  void runGenerationTurn(manifest, turnId, request, controller, recorder, attachments).finally(
    () => {
      inFlight.delete(designId);
    },
  );

  return { designId, turnId, kind: request.kind, appliedWithoutSpawn: false, versionId: null };
}

function emitSnapshot(designId: string, turnId: string | null, version: DesignVersion): void {
  emitStudio(designId, DESIGN_SSE_EVENTS.snapshot, {
    designId,
    turnId,
    snapshot: {
      versionId: version.id,
      n: version.n,
      createdAt: version.createdAt,
      origin: version.origin,
      label: version.label,
      fileCount: version.files.length,
      totalBytes: version.files.reduce((sum, f) => sum + f.byteSize, 0),
      restoredFrom: version.restoredFrom,
    },
  });
}

async function runGenerationTurn(
  manifest: DesignManifest,
  turnId: string,
  request: DesignTurnRequest,
  controller: AbortController,
  recorder: TurnRecorder,
  attachments: DesignAttachment[],
): Promise<void> {
  const { projectId, id: designId } = manifest;
  const signal = controller.signal;
  emitStudio(designId, DESIGN_SSE_EVENTS.status, { designId, status: 'drafting', turnId });

  try {
    // role "human", not "builder": this spawn is a person clicking Send. The
    // reserve exists to hold sessions back FOR them, so billing it as
    // autonomous work meant the reserve blocked the very turns it protects
    // (a full ledger denied Studio for 20min while Talk sailed through).
    // Only the window ceiling binds, same as Talk.
    const backend = await awaitClaimedSlot('human', {
      label: `studio ${request.kind} turn for ${designId}`,
      ref: `studio-turn/${designId}`,
    });
    logger.info(
      'studio',
      `Design turn ${turnId} (${request.kind}) claimed a ${backend} human slot`,
    );

    // `@mentions` are staged before the registry is built, because whether a
    // skill was staged is what decides whether the turn gets a tool to read it.
    const staged = await stageSkills(
      projectId,
      designId,
      request.kind === 'prompt' ? parseSkillMentions(request.prompt) : [],
    );

    let seq = 0;
    const written = new Map<string, number>();
    let declaredSchema: DesignManifest['tweaks'] = null;
    const registry = createDesignToolRegistry(sourceDir(projectId, designId), {
      ...(staged.length > 0 ? { stagedSkillsRoot: stagedSkillsDir(projectId, designId) } : {}),
      onFileWritten: (relativePath, byteSize) => {
        seq += 1;
        written.set(relativePath, byteSize);
        emitStudio(designId, DESIGN_SSE_EVENTS.fileProgress, {
          designId,
          turnId,
          path: relativePath,
          byteSize,
          seq,
          done: true,
        });
      },
      onTweakSchema: (schema) => {
        declaredSchema = schema;
      },
    });

    const { prompt, pinIds } = promptFor(manifest, request);
    const provider = await getStudioProvider()({
      systemPrompt: await systemPromptFor(manifest),
      prompt: `${prompt}${skillStagingPromptLine(staged)}`,
      images: await Promise.all(
        attachments.map(async (attachment) => ({
          mediaType: attachment.mediaType,
          base64: await readAttachmentBase64(projectId, designId, attachment),
        })),
      ),
      registry,
      cwd: sourceDir(projectId, designId),
      signal,
      model: GENERATION_MODEL,
    });

    let stopReason: 'stop' | 'aborted' | 'max_turns' | 'error' = 'stop';
    let turnError: string | null = null;
    // `tool_end` carries the outcome but not the arguments, so the card's
    // one-line summary has to come from the `tool_start` that opened it.
    const toolInputs = new Map<string, unknown>();
    for await (const event of runTurn({ provider, tools: registry, signal })) {
      switch (event.type) {
        case 'text_chunk':
          recorder.text(event.delta);
          break;
        case 'thinking_chunk':
          recorder.thinking(event.delta);
          break;
        case 'tool_start':
          toolInputs.set(event.toolUseId, event.input);
          recorder.toolStart(event.toolUseId, event.toolName, event.input);
          break;
        case 'tool_end':
          recorder.toolEnd(
            event.toolUseId,
            event.toolName,
            toolInputs.get(event.toolUseId),
            event.ok,
            event.error,
          );
          break;
        case 'turn_done':
          stopReason = event.stopReason;
          turnError = event.error ?? null;
          break;
        default:
          break;
      }
    }

    const version = await mutateManifest(projectId, designId, async (current) => {
      if (declaredSchema) current.tweaks = { ...(current.tweaks ?? {}), ...declaredSchema };
      const recorded = await recordVersion(
        current,
        request.kind === 'comment-apply'
          ? 'comment-apply'
          : request.kind === 'tweak'
            ? 'tweak'
            : 'prompt',
        labelFor(request, pinIds.length, written.size),
      );
      if (recorded) {
        // A pin is only "applied" once a turn actually produced a version —
        // otherwise a failed turn would silently clear the user's staged edits.
        for (const pin of current.pins) {
          if (pinIds.includes(pin.id)) {
            pin.status = 'applied';
            pin.appliedInVersionId = recorded.id;
          }
        }
      }
      return recorded;
    });

    if (version) emitSnapshot(designId, turnId, version);
    await recorder.finish(stopReason, turnError, [...written.keys()]);
    emitStudio(designId, DESIGN_SSE_EVENTS.turnDone, {
      designId,
      turnId,
      stopReason,
      filesWritten: written.size,
      versionId: version?.id ?? null,
      error: turnError,
    });

    // No files, no design to critique — and a critique of nothing would burn a
    // governor slot to say nothing.
    if (version && !signal.aborted) await critique(manifest, turnId, signal);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const kind = err instanceof GovernorAbort ? 'deferred by the governor' : 'malfunctioned';
    logger.error('studio', `Design turn ${turnId} ${kind}: ${message}`);
    // The transcript closes the turn honestly — a governor deferral or a
    // harness malfunction is what the retry button on that message is for.
    await recorder.finish('error', message, []);
    emitStudio(designId, DESIGN_SSE_EVENTS.error, { designId, turnId, message });
    emitStudio(designId, DESIGN_SSE_EVENTS.turnDone, {
      designId,
      turnId,
      stopReason: 'error',
      filesWritten: 0,
      versionId: null,
      error: message,
    });
  }
}

function labelFor(request: DesignTurnRequest, pinCount: number, fileCount: number): string {
  if (request.kind === 'comment-apply') return `applied ${pinCount} pinned edit(s)`;
  if (request.kind === 'tweak') return `tweaked ${Object.keys(request.values).length} token(s)`;
  return `${fileCount} file(s) from prompt`;
}

/** Status goes `critiquing` for the pass, then back — approval is a human act. */
async function critique(
  manifest: DesignManifest,
  turnId: string,
  signal: AbortSignal,
): Promise<void> {
  const { projectId, id: designId } = manifest;
  await mutateManifest(projectId, designId, (current) => {
    if (current.status === 'drafting') setStatus(current, 'critiquing');
  });
  emitStudio(designId, DESIGN_SSE_EVENTS.status, { designId, status: 'critiquing', turnId });

  const fresh = (await readManifest(projectId, designId)) ?? manifest;
  const report = await runCritiquePass(fresh, turnId, signal);

  await mutateManifest(projectId, designId, (current) => {
    current.critique = report;
    if (current.status === 'critiquing') setStatus(current, 'drafting');
  });
  emitStudio(designId, DESIGN_SSE_EVENTS.status, { designId, status: 'drafting', turnId });
}
