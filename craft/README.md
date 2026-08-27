# Craft references

Brand-agnostic craft knowledge. Each file is a small, dense rulebook on one
dimension of professional UI craft (typography, color, motion, …). Skills
opt into the references they need; the daemon injects only the requested
ones into the system prompt above the active skill body.

## Why a fourth axis next to skills, templates, and design systems

| Axis | Scope | Example |
|---|---|---|
| `skills/` | Functional capabilities invoked while doing work | `design-brief`, `brand-extract`, `imagegen` |
| `design-templates/` | Packaged artifact shapes | `saas-landing`, `dashboard`, `pricing-page` |
| `design-systems/` | Brand package: prose, token contract, and optional rich resources | `linear-app`, `apple`, `notion` |
| `craft/` | **Universal** craft knowledge — true regardless of brand | letter-spacing rules, accent-overuse caps, anti-AI-slop |

`DESIGN.md` tells the agent which colors and fonts a brand uses. `craft/`
tells the agent the universal rules a competent designer applies on top —
e.g. ALL CAPS always needs ≥0.06em tracking, regardless of the brand.

## How this repo actually consumes craft/ (read this, not the upstream mechanism below)

There is no `od.craft.requires` front-matter, no `pnpm lint:craft`, and no
`apps/daemon/src/lint-artifact.ts` in this repo — those describe upstream's
mechanism (open-design's, where this directory was vendored from) and are
inert here. Ligma's real path:

1. Each design system's `manifest.json` carries its own `craft: { applies,
   suggested, exemptions }` block — the design system's own declaration of
   which universal rules that brand is held to (`applies`/`suggested` selected
   in, `exemptions` excluded).
2. `apps/daemon/src/studio/craft.ts` reads that block and assembles the
   selected rule bodies for a generation, capped at 32KB total
   (`MAX_CRAFT_BYTES`). `anti-ai-slop` is always included regardless of the
   manifest — the one rule no brand gets to opt out of (`BASELINE_RULES`).
3. Enforcement is the **studio critique panel**
   (`apps/daemon/src/studio/critic.ts`), not a mechanical linter: one
   panelist lane (`craft-rules`) grades the generated design against the
   selected rule slugs (it is given the rule *names*, not the rule bodies —
   grading a writer against a rulebook it was never shown is the trap this
   repo's own commit history calls out and avoids differently: the writer
   *is* shown the bodies via step 2, only the grader works from slugs). A
   second lane (`accessibility`) grades directly against
   `accessibility-baseline.md`'s full text. This is a softer guarantee than a
   pass/fail lint gate — a critique score, not a hard block on persisting the
   artifact — and no doc previously said so.

If you're authoring a new design system's `manifest.json`, list the craft
slugs you want applied/suggested there; there is no other opt-in surface.

### Enforcement levels

- **Always graded.** `anti-ai-slop` — included in every generation via
  `BASELINE_RULES`, regardless of manifest.
- **Graded per design system.** Whatever the manifest's `craft.applies` /
  `craft.suggested` lists — see step 1 above.
- **Guidance only.** Any craft file not selected for a given design system:
  the agent may still read it via the Library, but nothing scores against it.

Note for anyone reading older/upstream guidance mixed into individual rule
files below: an earlier draft used `motion` as a future-slug placeholder. The
shipped equivalent today is `animation-discipline`.

## Files

| File | Section name | When to require |
|---|---|---|
| `typography.md` | `typography` | Any skill that emits typed content (~all skills) |
| `typography-hierarchy.md` | `typography-hierarchy` | Any skill that emits typed content where hierarchy must feel authored, not assembled — especially surfaces with a strong entry point, varied levels, or intentional rhythm. Compose with `typography`. |
| `typography-hierarchy-editorial.md` | `typography-hierarchy-editorial` | Skills whose primary artifact is a sustained reading surface: `blog-post`, `docs-page`, `digital-eguide`. Requires `typography` + `typography-hierarchy`. |
| `color.md` | `color` | Any skill that emits styled output (~all skills) |
| `anti-ai-slop.md` | `anti-ai-slop` | Marketing pages, landing pages, decks |
| `state-coverage.md` | `state-coverage` | Any skill with stateful UI (dashboards, mobile apps, forms, list/table views) |
| `animation-discipline.md` | `animation-discipline` | Any skill that ships motion: mobile apps, multi-screen flows, gamified UI, transitions, microinteractions |
| `accessibility-baseline.md` | `accessibility-baseline` | Any skill that ships interactive UI: dashboards, forms, mobile flows, anything with focus/labels/keyboard paths |
| `rtl-and-bidi.md` | `rtl-and-bidi` | Any skill that ships localized text or layout: blogs, docs, financial tables, mobile apps, anything that may render Arabic / Hebrew / Persian |
| `form-validation.md` | `form-validation` | Any skill whose primary artifact contains an interactive form: lead capture, sign-in, signup, settings, multi-step intake |
| `laws-of-ux.md` | `laws-of-ux` | Any skill whose composition decisions hit named cognitive limits: pricing pages (Hick's, Choice Overload, Von Restorff), dashboards (Pareto, Selective Attention, Working Memory), onboarding (Goal-Gradient, Zeigarnik, Peak-End), modals (Fitts's, Tesler's). Sibling axis to the rendering-rule files above — covers what to compose, not how to render. |

**Partial-stateful skills.** A skill that's mostly static but contains an embedded form, data table, or query surface should opt in. State-coverage rules apply to the stateful component, not the whole page.

Planned-but-unshipped slugs are recorded in
[`FUTURE_SECTIONS.md`](FUTURE_SECTIONS.md); do not hard-code a second future
list here.

## Attribution

Craft content is adapted from the MIT-licensed
[refero_skill](https://github.com/referodesign/refero_skill) project
(© Refero Design), with edits to fit OpenDesign's house style and link
back to OD's design tokens (`var(--accent)` etc.) instead of generic
Tailwind hex values.
