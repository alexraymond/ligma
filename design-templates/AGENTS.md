# design-templates

This directory holds **design templates** — packaged "shapes" the agent
renders into a project artifact (decks, prototypes, image/video/audio
templates, …). Each entry is a folder with a `SKILL.md` (same shape as
functional skills) plus rendering side files (`example.html`,
`assets/`, `references/`, …).

If the entry primarily *does work* on user input — utilities, briefs,
asset packagers, fidelity audits — it belongs under `../skills/` instead
(there is no `specs/current/skills-and-design-templates.md` in this repo to
read for the split — this paragraph and `skills/AGENTS.md` are the whole
rule: renders an artifact → here; works on input → `skills/`).

## How this repo actually consumes design-templates/ (not a `/api/design-templates` route)

There is no `/api/design-templates` route and no `/api/skills/:id/*` asset
routes serving this directory in this repo — those describe a different
(upstream) plumbing. The real consumers:

- **`packages/exporters/src/deck.ts`** — the deck exporter finds slides with
  `deck.querySelectorAll('.slide')` and extracts a `class="notes"` element
  per slide as speaker notes (hidden in every deck stylesheet with
  `.notes{display:none!important}`). This is the same `.slide`/`.notes`
  contract the "Deck preview navigation contract" section below describes —
  it is load-bearing for both the in-app preview and the exported PDF/deck
  file, which is why that section is unchanged from its original form.
- **`apps/web/src/components/studio/slide-nav.tsx`** — the studio's slide
  navigation reads either `is-active` or `active` as the current-slide class
  (`['is-active','active']`), matching the "Active slide state" rule below.
- Templates are surfaced from the New-project panel's per-mode "Start from"
  rail; there is no top-level Templates tab.

## Adding a design template

1. Create `design-templates/<my-template>/SKILL.md` with `name`,
   `description`, `triggers`, and an explicit `od.mode` (one of
   `prototype`, `deck`, `template`, `image`, `video`, `audio`).
2. Ship a baked `example.html` (and any side files) so the shared example and
   asset routes have preview content to serve.
3. Optionally drop additional baked samples under `examples/<key>.html`
   to surface them as derived `<parent>:<key>` cards.

## Known gaps (D32, vendored content — documented, not edited)

- **Missing `example.html`** (no baked preview for the gallery/asset routes):
  `dcf-valuation`, `guizang-ppt`, `html-ppt`, `hyperframes`, `last30days`,
  `live-artifact`, `replit-deck`, `x-research`.
- **`SKILL.md` missing `triggers` and/or `od.mode` front-matter** (the fields
  step 1 of "Adding a design template" above requires):
  `html-ppt-taste-brutalist`, `html-ppt-taste-editorial`,
  `web-prototype-taste-brutalist`, `web-prototype-taste-editorial`,
  `web-prototype-taste-soft`.

These are vendored entries from upstream; the gaps are noted here rather
than patched into the vendored files.

## Deck preview navigation contract

Any template with `od.mode: deck` must make its baked `example.html`
usable inside the gallery iframe without relying on the host app to add
navigation. Use a shared deck runtime where one is available; otherwise
ship a tiny local runtime with the same minimum behavior.

- **Keyboard:** `ArrowRight` / `ArrowDown` / `PageDown` / `Space` move to
  the next slide; `ArrowLeft` / `ArrowUp` / `PageUp` move to the previous
  slide; `Home` and `End` jump to the first and last slide. Ignore events
  from inputs, selects, textareas, and editable regions.
- **Wheel / trackpad:** accumulated `deltaX + deltaY` past a small threshold
  moves exactly one slide, then resets quickly so a single gesture does not
  overshoot.
- **Touch:** a horizontal swipe of roughly 50px or more, greater than the
  vertical movement, moves previous / next.
- **Dots:** render one clickable button per slide, update the active dot on
  every navigation path, and mark it with `aria-current="true"`.
- **Active slide state:** keep the visible slide marked with
  `.slide.active`; adding `.is-active` as a compatibility alias is fine.
  OpenDesign's preview bridge reads this state for the host slide counter,
  so it must stay in sync with keyboard, wheel, touch, and dot navigation.
- **Iframe safety:** focus the deck on load / pointer interaction so keyboard
  navigation works after the gallery preview appears. Avoid
  `scrollIntoView()` because it can move the parent page instead of the deck.
- **Fallbacks:** no-script and print output should still expose every slide.
  Hide non-active slides only after the runtime has booted.
