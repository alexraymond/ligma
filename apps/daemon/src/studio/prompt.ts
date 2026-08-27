/**
 * Pins → the structured instruction block an apply-turn sends.
 *
 * Ported from ligma-classic's `buildEnrichedPrompt`
 * (`src/renderer/src/store.ts:1451`), which was a pure function
 * landlocked inside a 3448-line Electron renderer store. Two changes, both
 * required by the port target and neither of them a rewrite:
 *
 *  1. The original hardcoded "apply every edit below to **index.html**" and
 *     "use text_editor str_replace" — true of a single-file Electron artifact,
 *     false here, where a design is a multi-file tree and the tools are this
 *     daemon's `read_file`/`write_file`. The edits carry their own file path.
 *  2. Pins are grouped by file, so a five-pin batch across three files reads as
 *     three units of work rather than five unrelated ones.
 *
 * The output of this function is *exactly* what goes on the wire. The
 * apply-preview endpoint and the apply turn both call it, because F4's whole
 * complaint about ligma-classic is that "Apply (N)" was opaque — a preview
 * that merely resembles the payload reproduces the defect it exists to fix.
 */

import type { CompiledInstructionPreview, DesignPin } from '@ligma/api';

/** Same 600-char budget the original used, per HTML excerpt. */
const MAX_HTML = 600;

function truncate(value: string): string {
  return value.length > MAX_HTML ? `${value.slice(0, MAX_HTML)}…` : value;
}

function scopeLabel(pin: DesignPin): string {
  return pin.scope === 'global' ? 'global (apply design-wide)' : 'element (this element only)';
}

/**
 * Compile a pin set plus an optional free-text prompt into one instruction.
 *
 * With no pins this returns the prompt verbatim — the same no-op passthrough
 * the original had, so a plain prompt turn and an apply turn with nothing
 * staged are byte-identical.
 */
export function compilePinInstruction(userPrompt: string, pins: DesignPin[]): string {
  if (pins.length === 0) return userPrompt;

  const byFile = new Map<string, DesignPin[]>();
  for (const pin of pins) {
    const bucket = byFile.get(pin.filePath);
    if (bucket) bucket.push(pin);
    else byFile.set(pin.filePath, [pin]);
  }

  const lines: string[] = [
    `## REQUIRED EDITS — you MUST apply every edit below (${pins.length} across ${byFile.size} file(s))`,
    '',
    'Each edit targets a specific element identified by its selector and outerHTML.',
    'Read the file with `read_file`, apply every edit, then save it with `write_file`.',
    'Do NOT skip any edit, and do NOT change anything an edit did not ask for.',
    '',
  ];

  let n = 0;
  for (const [filePath, filePins] of byFile) {
    lines.push(`## File: ${filePath}`, '');
    for (const pin of filePins) {
      n += 1;
      lines.push(`### Edit ${n}: ${pin.text}`);
      lines.push(`- **Target**: \`<${pin.tag}>\` at \`${pin.selector}\``);
      lines.push(`- **Current HTML**: \`${truncate(pin.outerHTML)}\``);
      if (typeof pin.parentOuterHTML === 'string' && pin.parentOuterHTML.length > 0) {
        lines.push(`- **Parent context**: \`${truncate(pin.parentOuterHTML)}\``);
      }
      lines.push(`- **Scope**: ${scopeLabel(pin)}`);
      lines.push(`- **Instruction**: ${pin.text}`);
      lines.push('');
    }
  }

  if (userPrompt.trim().length > 0) lines.push('---', '', userPrompt);

  return lines.join('\n');
}

/** The apply-preview payload — the compiled string plus what went into it. */
export function buildInstructionPreview(
  designId: string,
  userPrompt: string,
  pins: DesignPin[],
): CompiledInstructionPreview {
  return {
    designId,
    instruction: compilePinInstruction(userPrompt, pins),
    pinIds: pins.map((p) => p.id),
    userPrompt,
  };
}
