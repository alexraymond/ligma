# skills

This directory holds **functional skills** — capabilities the agent
invokes mid-task to do work on user input. Each skill is a folder with a
`SKILL.md` (YAML frontmatter + body) and any side files (`assets/`,
`references/`, scripts, …) the workflow needs. It also ships a curated
catalogue of design/creative skill stubs (see below) — both live in the same
flat directory.

Rendering shapes for prototypes, decks, documents, images, video, and audio
belong in [`../design-templates/`](../design-templates/) instead — see its
`AGENTS.md` for the split.

## How this repo actually consumes skills/ (not upstream's route/UI story)

- **Route:** `GET /api/skill-catalog` (`apps/daemon/src/routes/skill-catalog/route.ts`)
  serves this directory. It is deliberately **not** `/api/skills` — that path
  already serves a different, pre-existing feature (the user-authored
  `SkillDefinition` library agents are given from `data/skills-library.json`).
  Reusing the name would have collided with or silently repurposed a shipped
  feature.
- **UI surface:** the **Library page** (`apps/web/src/app/library/page.tsx`),
  "skill-catalog" tab — not "Integrations → Skills" (that surface doesn't
  exist in this app's nav).
- Read-only contract: GET only, `?id=` is a bare directory name validated
  with `isSafeSegment` before touching the filesystem, and only
  `skills/<id>/SKILL.md` is read for metadata.
- `LIGMA_SKILLS_DIR` overrides which directory is served (default: this one).
  See `docs/configuration.md`.

## Adding a skill

1. Create `skills/<my-skill>/SKILL.md` with `name`, `description`,
   `triggers`, and an `od: { mode: ... }` block (`utility`, `image`,
   `design-system`, etc. — see existing skills for the vocabulary in active
   use; there's no separate protocol doc in this repo to read instead).
2. Drop any side files alongside; reference them from the body using paths
   relative to the skill's own folder.
3. The route reads the directory live on each `GET /api/skill-catalog`
   request — no rebuild, no registration step, no daemon restart needed
   during local dev.

There is no `docs/skills-protocol.md` or `docs/skills-contributing.md` in
this repo (upstream-only docs) — the three steps above are the whole
contract here.

## Curated design / creative catalogue

Most entries in this directory are a curated catalogue of design/creative
skill stubs (lightweight frontmatter + a short body pointing at an upstream
repo, `od.category` set for the Library's category filter — e.g.
`image-generation`, `video-generation`, `slides`, `figma`,
`animation-motion`). They were seeded once from `VoltAgent/awesome-agent-skills`
and `ComposioHQ/awesome-claude-skills`; the seeding script that generated them
is not committed in this repo (nothing at `scripts/seed-curated-design-skills.ts`
or any other path here) — treat the stubs as hand-maintained content now, not
as output of a re-runnable generator. To add another curated stub, copy the
closest existing one and edit its frontmatter/body by hand.

Stubs intentionally do not vendor upstream assets. To run an upstream
workflow with its original scripts and references, copy the upstream folder
into your active agent's own skills directory (Claude Code, Codex, Cursor,
etc.) — each stub's body names its source.

## License

Skills in this directory are Apache-2.0 unless a skill's own `LICENSE` says
otherwise.
