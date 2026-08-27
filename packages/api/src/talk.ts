/**
 * Talk — the one human→system channel (UX spec §10, §16 "Conversation with
 * guardrails").
 *
 * A per-project thread. The human writes; the machine answers **citing real
 * objects** — task/run/verdict/design chips that deep-link into the surfaces
 * that already exist. The rule the spec states and this module enforces at the
 * type level: Talk is a channel, never a second source of truth. Nothing here
 * stores a fact; a chip is a *pointer* at a record that lives elsewhere, and a
 * chip whose id does not resolve is dropped by the daemon before the message is
 * ever written (see `engine/run-talk-respond.ts`).
 *
 * `parseTalkReply` is the model's contract, hand-written rather than zod'd
 * because this package has no runtime dependencies and never has. It is strict
 * on shape and says which field failed, so a malformed reply surfaces as a
 * named error instead of a half-built message.
 */

import type { AgentRole } from './types';

/** The record kinds a Talk message may cite. */
export const TALK_CHIP_KINDS = ['task', 'run', 'verdict', 'design'] as const;

export type TalkChipKind = (typeof TALK_CHIP_KINDS)[number];

export function isTalkChipKind(value: unknown): value is TalkChipKind {
  return typeof value === 'string' && (TALK_CHIP_KINDS as readonly string[]).includes(value);
}

/**
 * A citation. `id` is the real record's id — validated against the matching
 * store before the message lands, so a rendered chip always resolves.
 * `label` is display sugar the daemon fills in from the record it just proved
 * exists; absent means "render the id".
 */
export interface TalkChip {
  kind: TalkChipKind;
  id: string;
  label?: string;
}

/**
 * Who wrote a message. `"you"` is the human, `"system"` is the machine speaking
 * for itself (a governor deny, a failed pass), and anything else is an
 * `AgentRole` — the addressed crew member answering.
 */
export type TalkAuthor = 'you' | 'system' | AgentRole;

export interface TalkMessage {
  id: string;
  author: TalkAuthor;
  body: string;
  chips?: TalkChip[];
  createdAt: string;
}

/** `data/projects/<id>/talk.json`. */
export interface TalkThread {
  messages: TalkMessage[];
}

/** What the model is asked to return, once parsed. */
export interface TalkReply {
  reply: string;
  chips: TalkChip[];
}

export const MAX_TALK_BODY = 4000;
const MAX_CHIPS = 8;
const MAX_CHIP_ID = 120;
const MAX_CHIP_LABEL = 200;

function fail(what: string): never {
  throw new Error(`Talk reply invalid: ${what}`);
}

function parseChip(raw: unknown, index: number): TalkChip {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    fail(`chips[${index}] is not an object`);
  const chip = raw as Record<string, unknown>;
  const kind = chip['kind'];
  const id = chip['id'];
  const label = chip['label'];
  if (!isTalkChipKind(kind))
    fail(`chips[${index}].kind is not one of ${TALK_CHIP_KINDS.join(', ')}`);
  if (typeof id !== 'string' || id.trim() === '') fail(`chips[${index}].id is empty`);
  if (id.length > MAX_CHIP_ID) fail(`chips[${index}].id is longer than ${MAX_CHIP_ID} characters`);
  const out: TalkChip = { kind, id: id.trim() };
  if (label !== undefined) {
    if (typeof label !== 'string') fail(`chips[${index}].label is not a string`);
    if (label.length > MAX_CHIP_LABEL)
      fail(`chips[${index}].label is longer than ${MAX_CHIP_LABEL} characters`);
    if (label.trim() !== '') out.label = label.trim();
  }
  return out;
}

/**
 * Validate `{reply, chips?}` as it came back from the model. Throws a named
 * error rather than coercing: a reply we cannot read is a failed pass, and
 * silently repairing one is how a chip that points at nothing gets rendered.
 */
export function parseTalkReply(value: unknown): TalkReply {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('not an object');
  const raw = value as Record<string, unknown>;
  const rawReply = raw['reply'];
  const rawChips = raw['chips'];
  if (typeof rawReply !== 'string') fail('`reply` is not a string');
  const reply = rawReply.trim();
  if (reply === '') fail('`reply` is empty');
  if (reply.length > MAX_TALK_BODY) fail(`\`reply\` is longer than ${MAX_TALK_BODY} characters`);

  if (rawChips === undefined || rawChips === null) return { reply, chips: [] };
  if (!Array.isArray(rawChips)) fail('`chips` is not an array');
  if (rawChips.length > MAX_CHIPS) fail(`\`chips\` has more than ${MAX_CHIPS} entries`);
  return { reply, chips: rawChips.map(parseChip) };
}

/**
 * Where a chip goes. Each target is the surface that already renders that
 * record — same destinations `lib/nav.ts`'s `recordHref` uses for tasks, so a
 * chip and a search result land in the same place.
 *
 * `run` has no per-run page in this app (runs are a list with live rows), so a
 * run chip deep-links the list rather than inventing a route that 404s.
 */
export function talkChipHref(chip: TalkChip, projectId: string): string {
  const id = encodeURIComponent(chip.id);
  switch (chip.kind) {
    case 'task':
      return `/board?task=${id}`;
    case 'run':
      return '/runs';
    case 'verdict':
      return `/verification/${id}`;
    case 'design':
      return `/projects/${encodeURIComponent(projectId)}/studio?design=${id}`;
  }
}
