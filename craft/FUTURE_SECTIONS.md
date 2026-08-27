# Future Craft Sections

These slugs are referenced by some skills/templates as forward references to
`craft/<slug>.md` sections that haven't shipped. There is no `pnpm lint:craft`
in this repo to enforce that list mechanically (see `craft/README.md`'s
consumption note) — this file is purely a heads-up for a human reading a
`requires:`/`craft:` block that names one of these and wondering if it's a
typo.

- motion-discipline — **stale**: `animation-discipline` (shipped) already
  covers what this slug promised. `design-templates/live-dashboard/SKILL.md`
  still requires `motion-discipline` — that's a template-file fix, not a
  craft/ fix; flagged here (docs-audit D35), not corrected in this pass since
  it's outside `craft/`'s ownership.
- pixel-discipline
- typographic-rhythm
