# @ligma/web

The web face of ligma — a Next.js UI over the `apps/daemon` HTTP API. It has
no daemon or storage of its own; `/api/*` proxies to `apps/daemon`.

See the [root README](../../README.md) to run it, and
[`docs/configuration.md`](../../docs/configuration.md) for env vars.
