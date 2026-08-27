# Project notes

Ligma is the first adopted project — it adopts itself (twin-primitives §5). This
directory is the same `.ligma/` any adopted repo gets: a boot recipe, journeys,
and these notes. It is deliberately hand-written rather than inferred, so the
adoption pipeline has something real to be compared against.

## Architecture

- `apps/daemon` is the product. The HTTP + SSE API on 127.0.0.1:4477 is the only
  interface; `apps/web` and `apps/cli` are faces over it.
- JSON files under `data/` are the source of truth. No SQLite, deliberately.
- Verification-sensitive material stays central and is denied to spawned agents:
  `data/contracts/`, and `data/projects/<id>/{baselines,probes}/`. Journeys are
  the visible slice and live here, in the repo, on purpose.

## Boot recipe

`boot.json` boots the **web face** (`apps/web`, Next.js) on an OS-assigned port
via `-p`. The health marker is `Ligma`, the brand in the persistent rail, which
renders on every page — a 200 with no marker means we got a shell, not the app.

Known limits of the recipe, honestly:

- The booted web app talks to whatever daemon is reachable at the default port.
  A journey run therefore exercises the web face against the developer's daemon,
  not an isolated one. Isolating it needs a second process in the recipe;
  `boot.json` describes one dev command today.
- `seed` runs the daemon's demo seeder. Ligma's own task-verification runs still
  use the in-process dogfood seeder (`src/env/mission-control-adapter.ts`), which
  writes a deliberately hostile dataset no argv-array recipe can express.

## Journeys

Three hand-authored, matching the three flows the product is built around,
plus seven campaign-specific journeys added during the acceptance campaign
(`d1a-compose-promote`, `d1c-green-check`, `d2a-design-loop`, `d2b-verify-retry`,
`d3-adopt`, `d4-deck`, `d4b-batch-clear` — see `docs/evidence/DONE.md`). Ten
total in `.ligma/journeys/` today.

The three hand-authored ones:

- `jrn_capture_to_task` — capture → task
- `jrn_task_to_verified_done` — task → done, with the verdict linked
- `jrn_answer_a_decision` — the decision deck

Their goals are written the way a user would state them. The steps are
waypoints, never click scripts: a journey the panel can only pass by following
instructions proves the instructions work, not the product.

## Quirks

- `error` is never `failed`. A boot failure or a judge crash is a harness error
  and says nothing about the product. Anything that reports one as the other is
  a bug, in the data and in the UI.
- A green check without a verdict link is a bug, not a style choice.
