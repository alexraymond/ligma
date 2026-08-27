# Studio visual-workflow parity roadmap

Companion to `2026-08-26-studio-fullscreen-workspace-design.md` (Phase 1).
Grounded in a capability-by-capability delta against
`docs/parity/open-design-capabilities.md` and the upstream code at
origin/main; every claim in the underlying analysis is file-cited.

## The reframe

open-design has no design canvas — its studio is a chat pane beside a
one-file-at-a-time viewer. Ligma is already ahead on canvas & manipulation
(Wall, pan/zoom viewport, device-frame focus with an iframe pool,
content-addressed version rail with diff/restore, pin apply-preview) and on
several export paths (native PPTX; live terminal tab that upstream ships
flag-disabled). "Feature complete" therefore means closing the gaps around
the canvas: the conversation, the composer, the consumption of vendored
design systems, and the viewing conveniences.

## Phases (each shippable + verifiable alone)

**Status 2026-08-27: all eight phases shipped.** 1: f9bfca3 · 2: 5cb6c2c · 3: 3734130 (attachments as real
image blocks, @skill mentions with staged-copy isolation, mid-session
system swap; chips/gallery/directions landed via 6) · 4: d509408 · 5: 3ec0eea · 6: fe07d10 · 7: 1998d65 · 8: 7409ee4.
The execution-flow review's artifact shape (d9ddc12) closed verification
for non-program projects.

| Phase | What | Effort | Where |
| ----- | ---- | ------ | ----- |
| 1 | Full-screen workspace shell (in flight) | M | web |
| 2 | **Turn transcript** — the session stream (`session.ts:274`) currently discards text/thinking/tool events; persist them (messages on the manifest or NDJSON beside the critic transcript), forward as SSE, render a transcript pane: prose, collapsible thinking, grouped tool cards, produced files, streaming caret, copy, retry. Includes the `?panel=design-files` dead-door fix (`StagePanelHost` never mounted on studio). | L | daemon+web |
| 3 | **Composer** — image/reference attachment (reader + size gates exist in `workspace/file-upload.ts`), @-mention of the 136 vendored skills with staged-copy isolation, mid-session design-system swap, mount the kickoff chips/templates that already exist. | M | daemon+web |
| 4 | **Design-system depth** — generation currently sees 8,000 chars of DESIGN.md only; feed tokens.css, USAGE.md read-order, components.html, design-tokens.json (all vendored, already served to the Library). Best quality-per-line in the roadmap. | S–M | daemon |
| 5 | **Viewing surface** — preview⇄source toggle in Focus (code-view exists, mis-mounted), zoom auto-fit/levels/persistence, auto-open newest artifact, references/moodboard panel on Studio, PNG/JPEG/WebP export + copy-to-clipboard (puppeteer already present for PDF). | M | web |
| 6 | **First-design flow** — direction-cards style picker (vendor the visual-style catalog data, rebuild UI), starter prompts, a real design gallery replacing the bare `<select>`; question-forms in Studio turns (needs Phase 2). | M | web |
| 7 | Deck/template kinds — vendor `design-templates/` (15 deck templates, 36 themes), slide nav, speaker notes, deck-aware exports. Only if decks become a real ask. | L | daemon+web |
| 8 | Multi-panelist critique jury — upgrade the deliberate single-critic; ours is already always-on with replay where upstream's is toggle-hidden. Lowest urgency. | M | daemon |

Recommended definition of "feature complete" for a solo designer: **phases
1–6.** 7 and 8 are demand-driven.

## Explicitly out

Multi-user/collab (OD-140–153), community gallery / plugin marketplace /
share-to-community (no remote by design — `app/library/page.tsx`), Desktop
Pet, Automations/Orbit, BYOK + the ~25 CLI adapters (three backends by
design), locale catalog copy, Electron-only paths (native PDF, webview
browser), and manual click-to-select style editing — an on-the-record
product refusal in `studio-surface.tsx`; reversing it is its own decision.
