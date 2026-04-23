/**
 * Second-loop injection — after the agent fires its `agent_end` on the first
 * round of a design, we automatically post this as a follow-up user prompt
 * so the agent adds interactive depth without the user having to nudge it.
 *
 * Safety: `autoPolishFired` in the store dedupes by designId so we never
 * trigger more than once per design, and a Stop click during this second
 * round cancels it exactly like any other generation.
 */

export const POLISH_PROMPT_EN = `Now deepen the design you just produced. Focus on interactive depth — edit the existing index.html in place, do not rebuild:

1. Wire up 2-3 real state changes: tab switching, accordion / card expand, favorite toggle, avatar dropdown, or inline-edit. Plain React useState + handlers, no external libraries.
2. Add hover + press feedback to every clickable element: buttons scale(0.96) on active, cards lift 2px on hover, rows get a hover tint. Standard transition: \`transform 120ms var(--ease-out), background-color 120ms\`.
3. Define an <EmptyState /> component (icon + reason + CTA) for at least one list / table / grid. Keep the component in the file even if current data isn't empty.
4. Replace placeholder data with believable content: varied names, realistic numbers, relative dates ("3h ago", "yesterday"). No repeats, no Lorem.
5. Add one delightful touch: a keyboard shortcut hint rendered as <kbd>⌘K</kbd>, a chart that reveals a second layer on hover, a pulse animation on a fresh notification, or a clever empty-state copy line.

Keep the same cadence as round one: one prose line → view → one str_replace → one prose line. Each turn does one thing. Call \`done\` when finished.`;

export function pickPolishPrompt(_locale: string): string {
  return POLISH_PROMPT_EN;
}
