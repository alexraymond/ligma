/**
 * Append records → messages. The transcript pane's whole reducer, pure and
 * DOM-free (the shape `critique-replay.ts` set for the critique lane).
 *
 * The daemon streams `DesignTranscriptEntry` over SSE while a turn runs and
 * serves the identical records from `GET .../transcript` after a reload. One
 * fold for both is what makes those two views provably the same view, rather
 * than two renderers that agree until they don't.
 */

import type {
  DesignTranscriptEntry,
  DesignTranscriptMessage,
  DesignTranscriptPart,
  DesignTranscriptToolPart,
} from '@ligma/api';

/**
 * Add one entry to the list the pane holds, ignoring one it already has.
 *
 * The SSE channel replays its recent ring buffer on every (re)connect, so the
 * same entry can arrive twice on a flaky connection; entries are immutable and
 * uniquely placed by (turnId, timestamp, part), so "already seen" is decidable.
 */
export function mergeEntry(
  entries: DesignTranscriptEntry[],
  entry: DesignTranscriptEntry,
): DesignTranscriptEntry[] {
  // Cheap fields first: only an entry that already matches turn, role and
  // millisecond is worth serialising the part to compare.
  // ponytail: linear scan. Fine for the few hundred entries a design
  // accumulates; if a transcript ever gets long enough to feel it, keep a Set
  // of keys beside the array rather than making this smarter.
  const duplicate = entries.some(
    (existing) =>
      existing.at === entry.at &&
      existing.turnId === entry.turnId &&
      existing.role === entry.role &&
      JSON.stringify(existing.part) === JSON.stringify(entry.part),
  );
  return duplicate ? entries : [...entries, entry];
}

export function foldTranscript(entries: DesignTranscriptEntry[]): DesignTranscriptMessage[] {
  const messages: DesignTranscriptMessage[] = [];

  for (const entry of entries) {
    let message = messages.at(-1);
    if (!message || message.turnId !== entry.turnId || message.role !== entry.role) {
      message = {
        turnId: entry.turnId,
        role: entry.role,
        at: entry.at,
        parts: [],
        stopReason: null,
        error: null,
      };
      messages.push(message);
    }

    // `done` is the turn's outcome, not something it said — it belongs on the
    // message (where the retry button reads it), never in the part list.
    if (entry.part.kind === 'done') {
      message.stopReason = entry.part.stopReason;
      message.error = entry.part.error;
      continue;
    }

    if (entry.part.kind === 'tool') {
      const part = entry.part;
      const at = message.parts.findIndex(
        (p) => p.kind === 'tool' && p.toolUseId === part.toolUseId,
      );
      if (at >= 0) message.parts[at] = part;
      else message.parts.push(part);
      continue;
    }

    // Prose arrives in coalesced blocks; adjacent blocks of the same kind are
    // one paragraph that happened to be flushed twice.
    const last = message.parts.at(-1);
    if (
      (entry.part.kind === 'text' || entry.part.kind === 'thinking') &&
      last?.kind === entry.part.kind
    ) {
      message.parts[message.parts.length - 1] = {
        kind: entry.part.kind,
        text: last.text + entry.part.text,
        truncated: last.truncated || entry.part.truncated,
      };
      continue;
    }
    message.parts.push(entry.part);
  }

  return messages;
}

/** Every file this message produced, in write order. */
export function filesProduced(message: DesignTranscriptMessage): string[] {
  return message.parts.flatMap((part) => (part.kind === 'files' ? part.paths : []));
}

export function toolParts(message: DesignTranscriptMessage): DesignTranscriptToolPart[] {
  return message.parts.filter((part): part is DesignTranscriptToolPart => part.kind === 'tool');
}

/**
 * What the copy button puts on the clipboard: what the designer *said*.
 *
 * Thinking is excluded — it is shown collapsed for a reason, and pasting a
 * reasoning dump into a doc is not what "copy this message" means. A turn that
 * produced no prose falls back to it rather than copying nothing.
 */
export function messageCopyText(message: DesignTranscriptMessage): string {
  const proseOf = (kind: DesignTranscriptPart['kind']): string =>
    message.parts
      .flatMap((part) => (part.kind === kind && 'text' in part ? [part.text] : []))
      .join('\n\n')
      .trim();
  return proseOf('text') || proseOf('thinking');
}

/** The prompt a failed turn should re-send — the user message of that same turn. */
export function userPromptFor(messages: DesignTranscriptMessage[], turnId: string): string | null {
  const asked = messages.find((m) => m.turnId === turnId && m.role === 'user');
  const text = asked ? messageCopyText(asked) : '';
  return text === '' ? null : text;
}
