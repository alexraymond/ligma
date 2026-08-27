/**
 * Talk's one piece of text parsing: the explicit `@role` address token at the
 * head of the composer (UX spec §10, "Address the system (default) or a crew
 * member (`@researcher …`)").
 *
 * This is the *only* thing Talk reads out of what the human typed, and it is a
 * deliberate, documented affordance — a leading sigil, matched against the real
 * crew registry, not a guess about meaning. Everything else the conversation
 * produces (constraints, memories, chips) comes back as structured JSON from
 * the model or as an explicit button press; nothing downstream ever goes
 * looking for facts in the message body.
 *
 * An `@word` that is not a crew member is not an address — it stays in the body
 * and the message goes to the system, because silently reinterpreting someone's
 * typing is worse than sending it where they can see it went.
 *
 * Pure by design: this repo's web vitest runs in the node environment, so the
 * one bit of logic in the drawer lives here where it can be tested directly.
 */

export interface TalkAddress {
  /** `"system"` or a crew member id. */
  to: string;
  /** The message, with a recognised address token removed. */
  body: string;
}

/** The crew ids that can be addressed: the built-ins plus whatever the registry holds. */
export function talkRoleIds(
  builtIns: ReadonlyArray<{ id: string }>,
  registered: ReadonlyArray<{ id: string; status?: string }> = [],
): string[] {
  const ids = [
    ...builtIns.map((r) => r.id),
    ...registered.filter((a) => a.status !== 'inactive').map((a) => a.id),
  ];
  return [...new Set(ids)];
}

export function parseTalkAddress(input: string, roleIds: readonly string[]): TalkAddress {
  const trimmed = input.trim();
  if (!trimmed.startsWith('@')) return { to: 'system', body: trimmed };

  // Structural split at the first whitespace — the token boundary, not a
  // content match. `@researcher` with nothing after it is an address with an
  // empty body, which the composer refuses to send.
  const boundary = trimmed.search(/\s/);
  const token = (boundary === -1 ? trimmed : trimmed.slice(0, boundary)).slice(1);
  if (!roleIds.includes(token)) return { to: 'system', body: trimmed };

  return { to: token, body: boundary === -1 ? '' : trimmed.slice(boundary).trim() };
}

/** What the composer shows under the input: who this is about to go to. */
export function addressLabel(to: string): string {
  return to === 'system' ? 'the system' : `@${to}`;
}
