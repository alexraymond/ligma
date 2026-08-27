# Open Design — Capability Inventory (D7 Parity Audit)

Source repo: `/Users/alexraymond/open-design` (Apache-2.0). All file paths below
are relative to that repo root unless otherwise noted. Compiled by reading the
route map (`apps/web/src/router.ts`), the entry-shell nav rail
(`apps/web/src/components/EntryNavRail.tsx`), `README.md`, `QUICKSTART.md`,
`docs/*.md`, and the corresponding source directories — not from memory.

Rows marked **MULTI-USER** describe team/workspace/collaboration features and
are expected to be auto-waived in the parity audit.

**Commit pin:** compiled against `eefe796` (the local `~/open-design`
checkout's HEAD, still current on disk as of 2026-08-27). Since then,
`docs/parity/feature-track.md` has reviewed 240 further upstream commits via
fetch (through `d5aa100`) without updating the checkout or this inventory —
treat `feature-track.md` as the newer source for anything added upstream
after `eefe796`; this file's rows may be stale relative to it (see
`docs/audits/docs-audit-2026-08-27.md` D22/D45).

Rows marked **ORPHANED** are fully built but have no navigation entry point
(reachable only by typing the URL, or gated behind a feature flag that is
currently off).

---

## A. Routing & top-level pages

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| OD-001 | Client-side router: single `[[...slug]]` catch-all with `pushState`-based navigation, back/forward guard system, and deep-linkable routes | `apps/web/src/router.ts`, `apps/web/app/[[...slug]]/page.tsx` | No `react-router`; hand-rolled `parseRoute`/`buildPath`/`navigate`. |
| OD-002 | Home / entry landing page (`/`) | `apps/web/src/components/HomeView.tsx`, `EntryShell.tsx` | Default view; hero composer + recents. |
| OD-003 | Onboarding wizard page (`/onboarding`) | `apps/web/src/onboarding/`, `EntryShell.tsx` (`view === 'onboarding'`) | See section I. |
| OD-004 | Projects list page (`/projects`) | `EntryShell.tsx`, `RecentProjectsStrip` refs | Grid/list of the user's projects. |
| OD-005 | Individual project / Studio view (`/projects/:id[/conversations/:cid][/files/...]`) | `apps/web/src/components/ProjectView.tsx`, `FileWorkspace.tsx` | Deep-linkable to a specific conversation and/or open file. |
| OD-006 | **Automations page** (`/automations` or `/tasks`) — saved automations, metrics, "new automation" flow | `apps/web/src/components/TasksView.tsx`, `apps/web/src/styles/home/tasks.css` | **ORPHANED**: `router.ts` parses `/automations` and `/tasks` into `view: 'tasks'` and `TasksView` is fully wired into `EntryShell.tsx` (line ~1672), but `EntryNavRail.tsx` has no `NavButton` for it — no rail entry, no in-app link found anywhere else in `src/`. Only reachable by typing the URL. |
| OD-007 | Plugin marketplace / catalog tab (`/plugins`, home view) | `apps/web/src/components/PluginsSection.tsx`, `PluginsHomeSection.tsx` | Has a rail entry (`entry-nav-plugins`). |
| OD-008 | Plugin marketplace deep routes: catalog grid + detail page (`/marketplace`, `/marketplace/:pluginId`) | `apps/web/src/components/MarketplaceView.tsx`, `PluginDetailView.tsx`, `router.ts` (`kind: 'marketplace'`/`'marketplace-detail'`) | Separate `Route` kind from the `plugins` home-view tab; both resolve `/plugins/:id` and `/marketplace/:id` to the detail page. |
| OD-009 | Design systems catalog tab (`/design-systems`) | `apps/web/src/components/DesignSystemsTab.tsx`, `DesignSystemsSection.tsx` | Rail entry `entry-nav-design-systems`. |
| OD-010 | Design system creation wizard (`/design-systems/create`) | `apps/web/src/components/DesignSystemFlow.tsx`, `router.ts` (`kind: 'design-system-create'`) | Figma import, connector sync, token-contract rebuild. |
| OD-011 | Design system detail page (`/design-systems/:id`) | `DesignSystemFlow.tsx`, `router.ts` (`kind: 'design-system-detail'`) | |
| OD-012 | `/brands` and `/brands/:id` legacy deep-links | `router.ts` lines 119-124 | Redirect-only: brands were merged into design systems; a brand is a `user:<id>` design system. |
| OD-013 | Community template gallery (`/community`) | `router.ts` (`kind: 'community'`), `EntryShell.tsx` (`view === 'community'`) | Rail entry `entry-nav-community`; browse/remix shared design templates. |
| OD-014 | Integrations page (`/integrations`) | `router.ts`, `EntryShell.tsx` (`changeView('integrations')` at line 1220) | No rail `NavButton`, but reachable via in-app buttons (`onOpenIntegrations`, `onOpenMcp` in `EntryShell.tsx` ~1621-1923) and the Settings → Integrations section — not a dead route, just rail-less. |
| OD-015 | App Settings as a full page (`/settings`) vs. modal | `router.ts` (`view: 'settings'`), `SettingsDialog.tsx` (`page` presentation) | Same `SettingsDialog` component rendered in "page" mode instead of dialog mode. |
| OD-016 | Library UI (`/library`) | `apps/web/src/features/libraryUi.ts`, `LibraryPicker.tsx`, `LibrarySection.tsx` | **ORPHANED / feature-flagged off**: `LIBRARY_UI_VISIBLE = false` in `features/libraryUi.ts` — the route branch in `router.ts` is dead code while the flag is false, and the flag comment says the implementation is "kept available while the product surface is intentionally hidden for this release." |
| OD-017 | Team collaboration demo surface (`/collab-demo[/:projectId]`) | `apps/web/src/collab/CollabDemoView.tsx`, `router.ts` (`kind: 'collab-demo'`) | **ORPHANED / MULTI-USER**: router.ts's own comment calls it a "demo surface... clearly-stubbed demo identity"; no nav entry anywhere. Drives the real daemon presence/sync routes for a second tab to join the same project. |
| OD-018 | Desktop Pet overlay page (`/desktop-pet`, separate Next.js route outside the catch-all) | `apps/web/app/desktop-pet/page.tsx`, `app/desktop-pet/client.tsx` | Own top-level route, not part of `router.ts`'s SPA routing — a distinct Electron overlay window target. See section P. |
| OD-019 | Drafts, All-projects, Members, Board, Workspace-settings views | `router.ts` lines 148-162, `EntryShell.tsx` | **MULTI-USER** — team-workspace navigation-shell destinations; see section O. |

## B. Kickoff / hero composer (Home)

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| OD-020 | Free-form prompt box on Home ("type the brief") | `apps/web/src/components/HomeView.tsx`, `home-hero/` | Primary entry point for a new generation. |
| OD-021 | First-level scenario chip rail (Prototype / Slide deck / etc.) | `apps/web/src/components/home-hero/chips.ts` | Chip → `apply-scenario` action bound to a `DefaultScenarioPluginId`. |
| OD-022 | Second-level sub-category chip rail | `apps/web/src/components/home-hero/sub-chips.ts` | Derived from the same `SUBCATEGORIES` facet table as the Community grid (`plugins-home/facets.ts`); filters example prompts, does not bind a plugin. |
| OD-023 | Design-system picker in composer footer | `home-hero/chip-labels.ts`, `DesignSystemFlow.tsx` refs | Attaches an active brand package to the run. |
| OD-024 | Template picker — radial/pie menu of project-type templates | `apps/web/src/components/home-hero/TemplatePicker.tsx` | Hover-to-preview wedge UI (icon + name) on a frosted ring; confirms `activeChipId`. |
| OD-025 | Example-prompt placeholder carousel | `home-hero/PlaceholderCarousel.tsx`, `placeholderScenarios.ts` | Rotating placeholder prompts to seed ideas. |
| OD-026 | 93 ready-to-replicate image/video prompt templates (one-click drop into composer) | `prompt-templates/` (repo root), README §"Images" | Includes thumbnails, target model, aspect ratio, source attribution. |
| OD-027 | First-run guidance cascade (sheen-pulse trail: chip → card → send) | `apps/web/src/components/home-hero/firstRunGuide.ts` | Persisted per-install stage (`chip`→`card`→`done`); skipped for users who already have projects. |
| OD-028 | Composer `@`-mention of additional skills mid-prompt | `apps/web/src/components/composer/MentionNode.ts`, `LexicalComposerInput.tsx` | Lexical-based rich text composer; mentions resolve to `skillIds`. |
| OD-029 | Plugin-authoring shortcut chip / Figma shortcut / template shortcut | `home-hero/plugin-authoring.ts`, `chips.ts` lower-row shortcuts | |
| OD-030 | Pixel-scan animated logo / scenario art on Home | `home-hero/PixelScanLogo.tsx`, `pixel-scan/engine.ts`, `ScenarioArt.tsx` | Cosmetic branding animation, not functional gating. |
| OD-031 | Edge auto-scroll for the chip rail | `home-hero/EdgeAutoScroll.tsx` | UX affordance for a long horizontal chip rail. |

## C. Discovery question-forms

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| OD-032 | Inline `<question-form>` / `<ask-question>` structured clarifying-question protocol | `apps/web/src/artifacts/question-form.ts` | Agent-emitted JSON block parsed out of assistant text; `<ask-question>` accepted as a colloquial alias (issue #1194). |
| OD-033 | Rendered question form UI with 16 input types (radio, checkbox, select, text, textarea, number, range, date/time, color, url, email, tel, file, switch, direction-cards) | `apps/web/src/components/QuestionForm.tsx` | |
| OD-034 | Required-question gating before submission | `artifacts/question-form.ts` (`FormQuestion.required`), `QuestionForm.tsx` | Form-level required flag per question. |
| OD-035 | `direction-cards` rich visual-style picker (swatch row, type sample, mood blurb, references) | `question-form.ts` (`DirectionCard`), `runtime/visual-style-catalog.ts` | Category tabs (business/editorial/creative/minimal/all) and a gallery-open affordance. |
| OD-036 | Step-based multi-step forms (back / next / skip) | `QuestionForm.tsx` (`QuestionFormInteraction` step actions) | |
| OD-037 | Optional-form auto-continue timer (10 min) | `QuestionForm.tsx` (`OPTIONAL_FORM_AUTO_CONTINUE_SECONDS`) | Un-required forms auto-dismiss/continue after a timeout. |
| OD-038 | Partial-JSON streaming parse for in-flight question forms | `apps/web/src/runtime/partial-json.ts` | Lets the form render incrementally as the agent streams the JSON. |

## D. Studio & artifact types

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| OD-039 | Studio project shell — multi-artifact-type workspace per project | `apps/web/src/components/ProjectView.tsx`, `FileWorkspace.tsx` | One project can hold prototypes, decks, images, video, live artifacts. |
| OD-040 | Prototype artifacts — sandboxed-iframe single-page HTML, reads active `DESIGN.md` | `apps/web/src/runtime/srcdoc.ts` | `ProjectKind: 'prototype'` (`packages/contracts/src/api/projects.ts`). |
| OD-041 | Live artifacts / dashboards with an editable "tweaks panel" that re-renders without reload | README §"Live artifacts & dashboards"; `apps/web/src/runtime/design-delivery.ts` | Manifest-driven parameter tweaking. |
| OD-042 | Deck / presentation artifacts — page-through, keyboard nav | `apps/web/src/runtime/slide-nav.ts`, `speaker-notes.ts`, `deck-thumbnail-parser.ts` | `ProjectKind: 'deck'`; 15 deck templates / 36 themes under `design-templates/html-ppt-*/`. |
| OD-043 | Image generation artifacts (`gpt-image-2`, ImageRouter, custom API) | `packages/contracts/src/api/projects.ts` (`ProjectKind: 'image'`) | |
| OD-044 | Video / HyperFrames — agent-written HTML+CSS+GSAP rendered to deterministic MP4 via headless Chrome + FFmpeg | `design-templates/hyperframes/`, README §"Video & HyperFrames" | 11 HyperFrames templates + 39 Seedance prompts ship with the repo. |
| OD-045 | Audio artifacts (music / speech / SFX) | `packages/contracts/src/api/projects.ts` (`AudioKind`), `apps/web/src/types.ts` (`Surface`) | Paired with Suno v5 / Lyria 2 per README. |
| OD-046 | Mobile-frame chrome for mobile prototypes (pixel-accurate device frames) | `assets/frames/` (repo root), README §"Prototypes" | Agent never redraws the phone frame — shared asset. |
| OD-047 | Refresh-existing-codebase mode — hand the agent a real repo + `DESIGN.md` to rebrand components in place | README §"Why Open Design" | Distinct from greenfield generation. |
| OD-048 | In-app reference browser / mood-board panel ("Browser" workspace tab) | `apps/web/src/components/DesignBrowserPanel.tsx` | Captures reference URLs/screenshots into the project; desktop-host-aware (`isOpenDesignHostAvailable`). |
| OD-049 | Code viewer / syntax highlighting for generated source | `apps/web/src/runtime/shiki.ts`, `FileViewer.tsx` | |
| OD-050 | React-component render mode for artifact preview | `apps/web/src/runtime/react-component.ts`, `components/file-viewer-render-mode.ts` | |

## E. Critique Theater (Design Jury)

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| OD-051 | Design Jury / Critique Theater — 5-panelist automated design review loop (Designer/Critic/Brand/Accessibility/Copy) | `docs/critique-theater.md`, `apps/web/src/components/Theater/`, `apps/daemon/src/critique/` | Product-facing label "Design Jury"; internal code name "Critique Theater". |
| OD-052 | **Settings toggle for Critique Theater** — off by default (M0/M1 dark-launch) | `apps/web/src/components/Theater/hooks/useCritiqueTheaterEnabled.ts`, `SettingsDialog.tsx` ("Design Jury" section) | Confirms the hinted "behind a settings toggle." 4-tier resolver: per-skill `od.critique.policy` → per-project override (localStorage + `PATCH /api/projects/:id`) → `OD_CRITIQUE_ENABLED` env → rollout-phase default. |
| OD-053 | Live panel view: one lane per panelist, current-round score, must-fix count, per-dim sparkline | `apps/web/src/components/Theater/PanelistLane.tsx`, `TheaterStage.tsx` | |
| OD-054 | Composite score ticker with threshold marker across rounds | `apps/web/src/components/Theater/ScoreTicker.tsx` | Threshold 8.0/10; weights designer 0 / critic 0.4 / brand 0.2 / a11y 0.2 / copy 0.2. |
| OD-055 | Collapsed result badge (Shipped / Below threshold / Timed out / Interrupted / Degraded) | `apps/web/src/components/Theater/TheaterCollapsed.tsx`, `TheaterDegraded.tsx` | |
| OD-056 | Interrupt control mid-review | `apps/web/src/components/Theater/InterruptButton.tsx` | |
| OD-057 | Replay of a completed Theater run from a persisted `.ndjson` transcript, with speed control (Instant/Live/fixed-ms/Paused) and `J`/`K` round-scrub keyboard nav | `apps/web/src/components/Theater/hooks/useCritiqueReplay.ts`, `TheaterTranscript.tsx` | |
| OD-058 | Per-skill `od.critique.policy` frontmatter override (`required`/`opt-in`/`opt-out`) | `docs/skills-protocol.md` §2.1, `docs/critique-theater.md` §3 | |

## F. Runtime adapters (agent CLIs as data)

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| OD-059 | Data-driven adapter architecture — one `RuntimeAgentDef` object literal per CLI, zero per-agent subclassing | `docs/agent-adapters.md`, `apps/daemon/src/runtimes/types.ts`, `runtimes/defs/*.ts` | "Adding a CLI is a one-file change." |
| OD-060 | ~25 shipped CLI adapters incl. Claude Code, Codex, Cursor Agent, GitHub Copilot CLI, Devin, OpenCode, Qoder, Trae CLI, Pi, DeepSeek TUI, Amp, Hermes, Kimi, Kiro, Kilo, Vibe, Reasonix, CodeBuddy, Aider, Antigravity, Qwen, Grok Build | `apps/daemon/src/runtimes/registry.ts` (`BASE_AGENT_DEFS`), `docs/agent-adapters.md` §3 | Gemini is explicitly **not** an adapter id — "available as a BYOK provider and MCP client target, but its local generation runtime was retired." |
| OD-061 | Agent picker in Settings — availability, version/path, auth status, model list, diagnostics with fix actions, rescan action | `apps/web/src/components/SettingsDialog.tsx` (execution section), `apps/daemon` `/api/agents` | |
| OD-062 | Agent switcher / model + reasoning-level picker | `apps/web/src/state/config.ts` (`agentId`, `agentModels[agentId]`) | Per-run selection; changing it does not rebind an in-flight run. |
| OD-063 | BYOK proxy — no local CLI required, calls Anthropic/OpenAI/Azure/Google/Ollama-compatible endpoints directly | README §"Platform Compatibility"; `apps/web/src/components/byok/` | SSRF-guarded proxy at `/api/proxy/{provider}/stream`; presets incl. OpenAI, Atlas Cloud, Azure OpenAI, Google Gemini, Ollama, LM Studio, vLLM. |
| OD-064 | MCP server install into external coding agents (`od mcp install <agent>`) | README §"Install into your coding agent"; `apps/web/src/components/UseEverywhereModal.tsx`, `use-everywhere/sections.ts` | 16+ agents listed as supported MCP install targets (Claude Code, Codex, Cursor, Copilot, OpenCode, Trae, Kiro, Pi, Vibe, Hermes, etc.). |
| OD-065 | Live-streamed detection UX (`/api/agents?stream=1`) so Settings paints agent cards as each probe settles | `docs/agent-adapters.md` §9 | |

## G. Design system catalog

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| OD-066 | `manifest.json` / `DESIGN.md` / `tokens.css` triad package contract | `docs/design-systems.md` §1, `design-systems/_schema/manifest.schema.ts` | Legacy `DESIGN.md`-only folders remain a compatibility fallback, not the authoring target. |
| OD-067 | 151 bundled design-system packages | `design-systems/` (repo root, 155 entries), README | |
| OD-068 | Catalog master list ("master–detail browsing") — `DesignSystemsTab.tsx` | `apps/web/src/components/DesignSystemsTab.tsx` | Grid/list of packages with status, category, edit actions. |
| OD-069 | Design system detail / creation flow — draft creation, Figma import, connector-driven extraction, token-contract rebuild job, revision history + status | `apps/web/src/components/DesignSystemFlow.tsx` | `createDesignSystemDraft`, `importProjectFigma`, `startDesignSystemTokenContractRebuildJob`, `fetchDesignSystemRevisions`. |
| OD-070 | Live token preview — `tokens.css` compiled CSS custom properties consumed directly by generated artifacts | `docs/design-systems.md` §4 | |
| OD-071 | Rich package profile: `USAGE.md` agent read-order guide, `components.html` fixture, derived `components.manifest.json` / `design-tokens.json` / `tailwind-v4.css`, indexed `preview/` pages, `source/` importer evidence | `docs/design-systems.md` §1 "Rich package files" | Package-quality guard enforces completeness once a package opts in. |
| OD-072 | Catalog metadata precedence resolver (title/category/summary/surface) across manifest → Markdown → frontmatter → folder id | `docs/design-systems.md` §2 | |
| OD-073 | Localized catalog copy for 17 non-English locales, keyed by design-system id | `apps/web/src/i18n/content.ts` + 17 `content.<locale>.ts` modules | `zh-TW` intentionally reuses `zh-CN`. |
| OD-074 | Repository-level quality guard for design-system packages (`pnpm guard`) | `scripts/guard.ts` | Checks token schema, fixture sync, unknown-token allowlist, rich-profile completeness. |
| OD-075 | Brand extraction from a live website / brand references | `apps/web/src/runtime/brand-enrichment.ts`, `brand-intent.ts`, `useBrandExtract.ts`, `brand-browser-bridge.ts` | Feeds the design-system creation wizard. |

## H. Skills system

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| OD-076 | `SKILL.md` convention (Claude Code-compatible frontmatter + free-form Markdown body) | `docs/skills-protocol.md` §1 | Explicit "compatibility promise": any bundle with `SKILL.md` stays readable by Agent-Skills-compatible agents. |
| OD-077 | 100+ bundled functional skills | `skills/` (repo root, 166 entries) | Separate from rendering templates (`design-templates/`, separate registry/API). |
| OD-078 | `od:` frontmatter extensions (mode, surface, scenario, category, preview type, example prompts + i18n, design-system requirement, craft references, critique policy, defaults/featured flags) | `docs/skills-protocol.md` §2 | All optional; zero-config compatibility for unmodified Claude Code skills. |
| OD-079 | Skill discovery & precedence — separate registries for functional skills (`/api/skills`) vs. rendering templates (`/api/design-templates`); user-managed roots shadow bundled entries; live rescan on every listing request | `docs/skills-protocol.md` §3 | |
| OD-080 | **Staging isolation** — before a run, the daemon copies (dereferenced, not symlinked) the selected skill directory into `<project-cwd>/.od-skills/<basename>-<hash>/` so agent edits cannot mutate the source skill | `docs/skills-protocol.md` §"Runtime resource staging"; `docs/agent-adapters.md` §4 | Recursive stream-copy fallback for cross-filesystem failures. Confirms the hinted "staging isolation" capability. |
| OD-081 | Craft references — brand-agnostic craft `.md` files (`typography`, `color`, `anti-ai-slop`, …) injected between design-system context and skill body | `docs/skills-protocol.md` (`od.craft.requires`) | |
| OD-082 | `@`-mention selection of additional skills at prompt time | `apps/web/src/components/composer/MentionNode.ts` | See OD-028. |
| OD-083 | Skills-contributing merge pipeline (clone → PR) | `docs/skills-contributing.md` | Author-facing, but gates what ships in the catalog users browse. |

## I. Onboarding

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| OD-084 | Onboarding wizard flow (`/onboarding`) | `apps/web/src/onboarding/onboarding-entry.ts`, `EntryShell.tsx` (`OnboardingPanelHeader`) | |
| OD-085 | **Milestone-scoped one-shot onboarding hints** — first-prompt, first-generation, first-loop, first-artifact hints that fire once per milestone and never repeat | `apps/web/src/onboarding/first-prompt.ts`, `first-generation.ts`, `first-loop.ts`, `first-artifact-hint.ts` | Confirms the hinted "milestone-scoped one-shot onboarding" capability; state persisted so each hint shows at most once. |
| OD-086 | Onboarding provider/agent connection test with per-failure-class messaging | `apps/web/src/components/EntryShell.tsx` (`renderOnboardingProviderTestMessage`, `renderOnboardingAgentTestMessage`, `renderOnboardingProviderModelsMessage`, ~lines 3919-4023) | See section M — same taxonomy reused here. |
| OD-087 | Starter-prompt copy / recommendation engine for first-time users | `apps/web/src/onboarding/starter-copy.ts`, `recommendation.ts` | |
| OD-088 | Onboarding provider model discovery UI | `EntryShell.tsx` (`onboardingProviderModelLabel`, provider model list dedup) | |

## J. Settings — execution, providers, general

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| OD-089 | Settings dialog with 8 primary nav sections (Execution, General, Instructions, Memory, Media, Integrations, Privacy, About) | `apps/web/src/components/SettingsDialog.tsx` lines ~4275-4353 | |
| OD-090 | Additional non-rail settings sections reachable by deep-link/action: MCP client, Composio, Routines, Orbit, Design Systems, Workspace | `SettingsDialog.tsx` lines ~5781-6144 | |
| OD-091 | Custom instructions / system-prompt editor | `SettingsDialog.tsx` (`activeSection === 'instructions'`) | |
| OD-092 | Memory model picker — "same as chat" / suggested / custom override, separate from the main chat model | `apps/web/src/components/MemoryModelInline.tsx` | `PATCH /api/memory/config`; stored under `<dataDir>/memory/.config.json`. |
| OD-093 | Media provider configuration (image/video/audio generation providers) | `SettingsDialog.tsx` (`activeSection === 'media'`), `daemonMediaProviders` | |
| OD-094 | Privacy settings — consent-gated product analytics/session replay vs. always-on scrubbed safety telemetry | `SettingsDialog.tsx` (`activeSection === 'privacy'`), README §"Local-first, BYOK at every layer" | |
| OD-095 | Language picker (17+ locales) and theme/appearance segmented control | `apps/web/src/i18n/`, `EntryView.tsx` settings-section union (`'language'`, `'appearance'`) | Consolidated into General per #5517 (rail no longer duplicates them). |
| OD-096 | Notifications settings | `EntryView.tsx` settings-section union (`'notifications'`) | |
| OD-097 | Project-locations / linked-directories settings | `EntryView.tsx` settings-section union (`'projectLocations'`) | |
| OD-098 | About panel (version, links) | `SettingsDialog.tsx` (`activeSection === 'about'`) | |
| OD-099 | Message Center — in-app notification inbox with unread-count badge | `apps/web/src/components/MessageCenter.tsx`, `EntryNavRail.tsx` (`account-menu-message-center`) | Signed-in: lives in account menu; signed-out: own rail item. |

## K. Integrations, MCP & connectors

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| OD-100 | Integrations page/section — connect external systems and MCP tools | `apps/web/src/components/EntryShell.tsx` (`view === 'integrations'`), README §"Integrations" | See OD-014 for the route note. |
| OD-101 | External MCP server management (add/remove/test custom MCP servers) | `apps/web/src/components/McpClientSection.tsx` | Dual surface: Settings → Integrations, or Settings → MCP directly (`surface` prop). |
| OD-102 | Composio connector catalog / browser (hundreds of third-party connectors) | `apps/web/src/components/ConnectorsBrowser.tsx`, `state/mcp.ts`, `components/connectors-state.ts` | Category-filtered browse UI; connect/disconnect flow. |
| OD-103 | "Use Open Design everywhere" guide modal — CLI / MCP / HTTP / Skills tabs with copyable snippets | `apps/web/src/components/UseEverywhereModal.tsx`, `use-everywhere/sections.ts`, `agent-guide.ts` | Same content module feeds both the modal and an agent-handoff Markdown blob. |
| OD-104 | Hand-off menu — open project folder in a local editor, or copy CLI prompts for handing the same folder to another code agent | `apps/web/src/components/HandoffButton.tsx` | Reads `HostEditorsResponse` for installed local editors. |

## L. Automations, Routines & Orbit

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| OD-105 | Saved Automations list + metrics on the Automations page | `apps/web/src/components/TasksView.tsx` | See OD-006 — page itself is orphaned from nav. |
| OD-106 | Routines — recurring scheduled project runs (hourly/daily/weekdays/weekly) | `apps/web/src/components/RoutinesSection.tsx`, `packages/contracts` (`Routine`, `RoutineSchedule`, `RoutineRun`) | Reachable from Settings; feeds the (orphaned) Automations page's saved-automations list. |
| OD-107 | Routine run-failure localized reason messages | `apps/web/src/i18n/runErrors.ts` (`localizeRunFailureReason`) | |
| OD-108 | Orbit — connector-driven scenario that generates a digest/briefing project from connected integrations (e.g. Composio) data | `apps/web/src/components/SettingsDialog.tsx` (`OrbitSection`, ~line 6738) | Gated behind having a Composio API key + ≥1 connected connector; own template registry filtered by `scenario === 'orbit'`. |

## M. Exports & handoff

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| OD-109 | Export to PDF (browser print dialog, deck-aware) | `apps/web/src/runtime/exports.ts` | |
| OD-110 | Export to standalone HTML (single file, inlined assets) | `apps/web/src/runtime/exports.ts`, `srcdoc.ts` | |
| OD-111 | Export to ZIP (artifact + coding-handoff guide) | `apps/web/src/runtime/exports.ts`, `zip.ts` | Bundles `DESIGN-HANDOFF.md` and `DESIGN-MANIFEST.json`. |
| OD-112 | Export to Markdown (verbatim source, `.md`) | `apps/web/src/runtime/exports.ts` | For LLM-context/vault ingestion (issue #279). |
| OD-113 | Deck export to PPTX (agent-driven skill) | README §"Decks" | Skill-based, not a client-side exporter. |
| OD-114 | Desktop-host-native PDF capture/print (Electron path, vs. browser popup+print fallback) | `apps/web/src/runtime/exports.ts` (`captureHostPage`, `printHostPdf` from `@open-design/host`) | `isOpenDesignHostAvailable()` gate. |
| OD-115 | Export diagnostics button (surfaces export-pipeline error codes) | `apps/web/src/components/ExportDiagnosticsButton.tsx`, `analytics/export-error-code.ts` | |
| OD-116 | `<artifact>` block extraction for `streamFormat: 'plain'` adapters (daemon-side, but drives what the user sees land as a project file) | `docs/agent-adapters.md` §5.12 | Supports `text/html`, `text/css`, `image/svg+xml`, markdown. |

## N. Error recovery & diagnostics

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| OD-117 | **Failure-class-aware error messaging for provider connection tests** — distinct copy per `auth_failed`, `forbidden`, `not_found_model`, `invalid_model_id`, `invalid_base_url`, `rate_limited`, `upstream_unavailable`, `timeout` | `apps/web/src/components/EntryShell.tsx` (`renderOnboardingProviderTestMessage`) | Confirms the hinted "failure-class-aware error recovery" capability. |
| OD-118 | Failure-class-aware messaging for agent CLI connection tests — `agent_not_installed`, `agent_auth_required`, `agent_spawn_failed`, `rate_limited`, `timeout` | `EntryShell.tsx` (`renderOnboardingAgentTestMessage`) | |
| OD-119 | Failure-class-aware messaging for model-discovery calls — adds `no_models`, `unsupported_protocol` | `EntryShell.tsx` (`renderOnboardingProviderModelsMessage`) | |
| OD-120 | Font-loading recovery under the packaged `od://` protocol (bypasses Chromium's broken font loader, re-registers fonts from fetched bytes) | `apps/web/src/runtime/font-recovery.ts` | Self-heals a specific desktop-packaging failure mode. |
| OD-121 | Pre-run balance gate (hard-block vs. soft-warning tiers) before starting an OD Cloud (AMR) run | `apps/web/src/runtime/amr-balance-gate.ts`, `AmrBalanceDialog.tsx` | Hard: signed-out or balance ≤ $0. Soft: at/below warning line, dismissible. |
| OD-122 | Auth-retry continuation for OD Cloud runs | `apps/web/src/runtime/amr-auth-retry-continuation.ts` | |
| OD-123 | Low-balance recovery plan / guidance | `apps/web/src/runtime/amr-low-balance-plan.ts`, `amr-guidance.ts` | |
| OD-124 | Critique Theater `degraded` diagnostics (malformed_block / oversize_block / adapter_unsupported / protocol_version_mismatch / missing_artifact) surfaced in the collapsed badge | `docs/critique-theater.md` §6 | |
| OD-125 | Oversized-prompt guard with actionable `AGENT_PROMPT_TOO_LARGE` error (Windows cmd-shim / direct-exe command-line budget checks) | `docs/agent-adapters.md` §5.11 | Daemon-side, but the user-visible error message and remediation copy are part of the product surface. |

## O. Shimmer / loading & progress primitives

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| OD-126 | Shimmer-text progress primitive — "thinking"/"preparing"/streaming labels shimmer via `.shimmer-text` CSS class | `apps/web/src/components/AssistantMessage.tsx` (lines ~1592, 3266, 3489, 3597, 3725), `apps/web/src/styles/viewer/*.css` | Confirms the hinted "shimmer progress primitive" — implemented as a reusable CSS class + label pattern, not a single component. |
| OD-127 | Skeleton loaders (`Skeleton`, `DesignCardSkeleton`, `CenteredLoader`, spinner) | `apps/web/src/components/Loading.tsx` | Used across Design Systems tab, bootstrap loads. |
| OD-128 | Password/API-key field shimmer overlay while a probe is in flight | `apps/web/src/components/SettingsDialog.tsx` (~line 6459, `field-input-skeleton-shimmer`) | |

## P. Desktop Pet

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| OD-129 | Desktop Pet — animated companion overlay window (own top-level Electron route) | `apps/web/app/desktop-pet/`, `apps/web/src/components/pet/DesktopPetSurface.tsx`, `PetOverlay.tsx` | See OD-018. |
| OD-130 | Pet sprite/animation system with a "Codex Atlas" sprite sheet | `apps/web/src/components/pet/codexAtlas.ts`, `PetSpriteFace.tsx`, `pets.ts` | |
| OD-131 | Pet task-center integration (pet reacts to run status) | `apps/web/src/components/pet/taskCenter.ts` | |
| OD-132 | Pet settings panel | `apps/web/src/components/pet/PetSettings.tsx`, `EntryView.tsx` settings-section union (`'pet'`) | |

## Q. Workspace tabs & in-project surfaces

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| OD-133 | Extensible "+" tab launcher for the project workspace | `apps/web/src/components/workspace/tab-launcher.ts`, `TabLauncherMenu.tsx` | Registry pattern: one `LauncherAction` per tab kind. |
| OD-134 | Side-chat tab (secondary chat panel alongside the main file view) | `apps/web/src/components/workspace/SideChatTab.tsx`, `useConversationChat.ts` | |
| OD-135 | Terminal tab (spawns a real PTY session in the project directory) | `apps/web/src/components/workspace/TerminalViewer.tsx`, `tab-launcher.ts` (`createTerminal`) | **Feature-flagged off**: `ENABLE_TERMINAL_WORKSPACE_ENTRYPOINT = false` in `tab-launcher.ts` — fully implemented (PTY spawn, tab rendering) but the "+" launcher entry is disabled, so it is not currently reachable through the UI at all. |
| OD-136 | Blank-page creator dialog | `tab-launcher.ts` (`ENABLE_BLANK_PAGE_WORKSPACE_ENTRYPOINT = false`), `FileWorkspace.tsx` (`PageCreatorDialog` wiring) | **Feature-flagged off** (product call, 2026-07-27) — same pattern as OD-135; code path intact, entry point disabled. |
| OD-137 | New Browser tab (mounts `DesignBrowserPanel` as a workspace tab) | `tab-launcher.ts` (`createBrowser`) | Enabled; distinct from the disabled Terminal/blank-page entries. |
| OD-138 | Design Files tab — sketch/document creation, upload picker | `apps/web/src/components/design-files/`, `tab-launcher.ts` (`createSketch`, `createDocument`, `uploadDesignFiles`) | |
| OD-139 | Auto-open-file behavior when a run produces a new artifact | `apps/web/src/components/auto-open-file.ts` | |

## R. Multi-user / team / workspace collaboration (MULTI-USER)

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| OD-140 | **MULTI-USER** — Workspace switcher (personal vs. team workspaces, directory listing, switch-active-workspace) | `apps/web/src/components/EntryNavRail.tsx` (`workspace-switcher`), `collab/useWorkspaceContext.ts` | |
| OD-141 | **MULTI-USER** — Team invite flow (local form when seats available; deep-links to Vela console otherwise) | `apps/web/src/components/InviteDialog.tsx`, `EntryNavRail.tsx` (`resolveWorkspaceInviteTarget`) | |
| OD-142 | **MULTI-USER** — Drafts / All-projects team destinations | `router.ts` (`view: 'drafts' \| 'all-projects'`), `EntryNavRail.tsx` (`entry-nav-drafts`, `entry-nav-all-projects`) | All-projects is team-only (`isTeam` gate). |
| OD-143 | **MULTI-USER** — Members / workspace dashboard / workspace settings (link out to external Vela console) | `EntryNavRail.tsx` (`teamConsoleUrl`), `router.ts` (`view: 'members' \| 'board' \| 'workspace-settings'`) | Deliberately not built as in-client views — "B's console owns" these per code comments. |
| OD-144 | **MULTI-USER** — Board (team kanban-style view) | `EntryShell.tsx` (`view === 'board'`, line ~990/1894), `router.ts` | |
| OD-145 | **MULTI-USER** — Live presence bar (avatars, online state) on a shared project | `apps/web/src/collab/PresenceBar.tsx`, `collab-client.ts` | |
| OD-146 | **MULTI-USER** — Real-time collaborative sync / co-editing session | `apps/web/src/collab/collab-session.ts`, `useCollab.ts`, `useProjectCollab.ts` | |
| OD-147 | **MULTI-USER** — Anchored comments on files with drift-tracking/repositioning | `apps/web/src/collab/comment-anchor-client.ts`, `CommentDriftDemo.tsx`, `apps/web/src/comments` (`AnchorWriteBack`) | Server COALESCEs the last-good anchor position. |
| OD-148 | **MULTI-USER** — Team member directory (polling + SSE floor, cached per-identity) | `apps/web/src/collab/team-members-store.ts`, `useTeamMembers.ts`, `WorkspaceMemberDirectoryPreloader.tsx` | |
| OD-149 | **MULTI-USER** — Team plan / billing surface (seat count, plan tier badge, upgrade CTA) | `apps/web/src/collab/team-plan.ts`, `EntryNavRail.tsx` (billing chip in account menu) | Billing/checkout itself lives in the external Vela console. |
| OD-150 | **MULTI-USER** — File sync status badge (shows a file's shared/sync state across collaborators) | `apps/web/src/collab/FileSyncBadge.tsx` | |
| OD-151 | **MULTI-USER** — Public file publishing (share a project file outside the workspace) | `apps/web/src/collab/public-file-publish.ts`, `project-shared-status.ts` | |
| OD-152 | **MULTI-USER** — Optimistic project-ownership transfer | `apps/web/src/collab/optimistic-project-ownership.ts` | |
| OD-153 | **MULTI-USER** — Sign-out confirmation gate (arms before running the real logout chain) | `apps/web/src/components/SignOutConfirmDialog.tsx`, `EntryNavRail.tsx` | Single-user UX, but only meaningful in the cloud-identity/workspace context — kept adjacent to the team rows. |

## S. Plugins system

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| OD-154 | Plugin catalog browsing with facets/subfacets, popularity ranking, curated priority | `apps/web/src/components/plugins-home/facets.ts`, `pluginPopularity.ts`, `curatedPriority.ts` | 277 plugins per README comparison table. |
| OD-155 | Plugin detail view — scenario/design-system/example/media detail panels, byline, share menu | `apps/web/src/components/plugin-details/` (9 files) | |
| OD-156 | Plugin install / use tracking | `apps/web/src/utils/pluginInsertionTracking.ts`, `plugin-details/pluginUseMenu.ts` | |
| OD-157 | Save/bookmark a plugin | `apps/web/src/components/plugins-home/savedPlugins.ts` | |
| OD-158 | Plugin authoring entry point from Home | `apps/web/src/components/home-hero/plugin-authoring.ts` | |
| OD-159 | Plugin source/skill-description composition for the registry | `apps/web/src/runtime/plugin-source.ts`, `plugin-skill-descriptions.ts` | |
| OD-160 | Share-to-community prompt flow (publish a plugin/design-system/template to the shared gallery) | `apps/web/src/components/share-to-community/shareToCommunityPrompt.ts` | Feeds the Community gallery (OD-013). |
| OD-161 | Publishing-a-plugin guide + self-hosted registry support | `docs/publishing-a-plugin.md`, `docs/self-hosting-a-registry.md` | Author/operator facing, gates what appears in the catalog. |

## T. BYOK & provider configuration

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| OD-162 | BYOK provider picker (Anthropic/OpenAI/Azure/Google/Ollama/etc., with per-provider preflight validation) | `apps/web/src/components/byok/ByokProviderPicker.tsx`, `preflight.ts`, `validation.ts` | |
| OD-163 | BYOK API-key field with connection-test control | `apps/web/src/components/byok/ByokKeyField.tsx`, `ByokConnectionTestControl.tsx` | |
| OD-164 | BYOK custom base-URL + model-id fields | `apps/web/src/components/byok/ByokProviderBaseUrl.tsx`, `ByokModelField.tsx` | |
| OD-165 | Local-model discovery via `litellm` model catalog | `apps/web/src/state/litellm-models.json` | |

## U. Miscellaneous

| ID | Capability | Where in source | Notes |
|---|---|---|---|
| OD-166 | ⌘K project search palette | `apps/web/src/components/EntryNavRail.tsx` (`onOpenSearch`, `entry-nav-search`) | |
| OD-167 | GitHub star count live badge in the account menu | `apps/web/src/components/useGithubStars.ts`, `EntryNavRail.tsx` | |
| OD-168 | In-app updater popup (downloaded-but-unopened installer notice) | `apps/web/src/components/EntryNavRail.tsx` (`updaterSlot`, `UpdaterPopup` reference) | Desktop-app-only surface. |
| OD-169 | Cloud sign-in tip / callout for local (no-cloud-identity) state | `apps/web/src/components/CloudSignInTip.tsx` | |
| OD-170 | 17-locale i18n coverage across the whole app shell | `apps/web/src/i18n/locales/`, `content.<locale>.ts` | de, fr, ru, zh-CN, ja, id, es-ES, pt-BR, ar, fa, ko, pl, hu, uk, tr, th, it (+ zh-TW aliasing zh-CN). |
| OD-171 | Cross-tab config sync (localStorage `storage` event + same-tab CustomEvent pattern) | `apps/web/src/components/Theater/hooks/useCritiqueTheaterEnabled.ts` (pattern), `state/config.ts` | Generalized pattern, illustrated concretely by the Critique Theater toggle. |

---

## Summary of orphaned / hidden capabilities found

Fully built, wired-in features with **no discoverable UI entry point** (or an
entry point currently disabled by a feature flag):

1. **Automations page** (`/automations`, `/tasks` → `TasksView.tsx`) — no nav-rail entry anywhere; only reachable by typing the URL. (OD-006)
2. **Library UI** (`/library` → `LibraryPicker.tsx` / `LibrarySection.tsx`) — feature-flagged off entirely via `LIBRARY_UI_VISIBLE = false`; the route itself is dead while the flag is off. (OD-016)
3. **Collab demo surface** (`/collab-demo/:projectId` → `CollabDemoView.tsx`) — explicitly documented in `router.ts` as a demo surface with a stubbed identity; no nav entry. (OD-017, MULTI-USER)
4. **Workspace Terminal tab** — fully implemented PTY-spawn tab, disabled via `ENABLE_TERMINAL_WORKSPACE_ENTRYPOINT = false` in `tab-launcher.ts`. (OD-135)
5. **Blank-page creator** — `PageCreatorDialog` wiring intact in `FileWorkspace.tsx`, disabled via `ENABLE_BLANK_PAGE_WORKSPACE_ENTRYPOINT = false` (product call, 2026-07-27). (OD-136)
6. **Critique Theater / Design Jury** — not orphaned exactly, but confirmed hidden behind a Settings toggle (`useCritiqueTheaterEnabled`), off by default during the M0/M1 rollout phases. (OD-052)

`/integrations` (OD-014) is rail-less but not truly orphaned — it's reachable via in-app buttons in `EntryShell.tsx` and the Settings dialog, so it was **not** counted above as hidden, only as lacking a persistent nav-rail item.
