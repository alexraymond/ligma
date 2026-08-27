# NOTICE

Ligma bundles third-party open-source software at runtime and/or build time. The packages listed below carry notice requirements under their respective licenses. All are MIT, BSD, or Apache-2.0 compatible.

There is no build step in this repo that generates a consolidated
`THIRD_PARTY_LICENSES.txt` — no such file is produced anywhere in this
checkout's build pipeline (checked: no reference to that filename in any
package.json, build config, or script). If you redistribute a packaged
build, generate that manifest yourself (e.g. `license-checker` over the
relevant workspace's `node_modules`) or point at each package's own
license, linked below.

## Runtime dependencies

Notice-bearing runtime packages still bundled by this repo. The list is not
exhaustive of every transitive dependency — the factory's own additions
(Express, Next.js, Turborepo, the `claude`/`codex`/`gemini` CLIs it spawns)
aren't all listed, and each `package.json` under `apps/`/`packages/` is the
accurate, current dependency list for that workspace if you need it.

| Package | License | Upstream | Used by |
| ------- | ------- | -------- | ------- |
| React | MIT | https://react.dev/ | `apps/web` |
| Radix UI primitives | MIT | https://www.radix-ui.com/ | `apps/web` |
| Tailwind CSS | MIT | https://tailwindcss.com/ | `apps/web` |
| lucide-react | ISC | https://lucide.dev/ | `apps/web` |
| @anthropic-ai/claude-agent-sdk | MIT | https://github.com/anthropics/claude-code | `apps/daemon`, `packages/providers` |
| @mariozechner/pi-ai | MIT | https://github.com/badlogic/pi-mono | `packages/core`, `packages/providers` |
| pptxgenjs | MIT | https://github.com/gitbrent/PptxGenJS | `packages/exporters` |
| puppeteer-core | Apache-2.0 | https://github.com/puppeteer/puppeteer | `packages/exporters` |

The Electron-era entries (Electron, Vite, Zustand, better-sqlite3, and the
self-hosted `@fontsource-variable/*` faces) were dropped when the legacy
desktop app left this repo — see `CHANGELOG.md`. Their attribution lives with
the app in the separate `ligma-classic` repo.

## Build-time / developer dependencies

| Package | License | Upstream |
| ------- | ------- | -------- |
| esbuild | MIT | https://esbuild.github.io/ |
| Turborepo | MPL-2.0 | https://turbo.build/ |
| Vitest | MIT | https://vitest.dev/ |
| Playwright | Apache-2.0 | https://playwright.dev/ |
| Biome | MIT / Apache-2.0 | https://biomejs.dev/ |

If you redistribute Ligma, include the upstream license text for each bundled package (see "Runtime dependencies" and "Build-time / developer dependencies" above).

## Vendored code

| Path | License | Upstream |
| ---- | ------- | -------- |
| `craft/` | Apache-2.0 | https://github.com/nexu-io/open-design |
| `design-systems/` | Apache-2.0 | https://github.com/nexu-io/open-design |
| `skills/` | Apache-2.0 | https://github.com/nexu-io/open-design |
| `assets/frames/` | Apache-2.0 | https://github.com/nexu-io/open-design |
| `design-templates/` | Apache-2.0 | https://github.com/nexu-io/open-design |
| `apps/daemon/src/studio/layout.ts` (adapted stylesheet) | Apache-2.0 | https://github.com/nexu-io/open-design |
| `apps/web/src/components/studio/visual-styles.ts` (style catalog data) | Apache-2.0 | https://github.com/nexu-io/open-design |

Verbatim copies of the Apache-2.0 license text are included at `craft/LICENSE`,
`design-systems/LICENSE`, and `skills/LICENSE`. Vendored files retain any
upstream license headers.

`design-systems/` carries the full upstream catalog (152 packages plus
`_schema/`). `skills/` carries the upstream catalog minus entries whose own
license marker is not Apache-2.0 (each such entry ships its own `LICENSE` or
declares `license: MIT` in its `SKILL.md` frontmatter — not Apache-2.0, so not
covered by the blanket grant above): `brandkit`, `brutalist-skill`,
`emil-design-eng`, `gpt-tasteskill`, `gsap-core`, `gsap-frameworks`,
`gsap-performance`, `gsap-plugins`, `gsap-react`, `gsap-scrolltrigger`,
`gsap-timeline`, `gsap-utils`, `image-to-code-skill`,
`imagegen-frontend-mobile`, `imagegen-frontend-web`, `minimalist-skill`,
`output-skill`, `redesign-skill`, `review-animations`, `soft-skill`,
`stitch-skill`, `taste-skill`, `taste-skill-v1`, `web-clone`,
`web-design-guidelines`, `writing-guidelines` (26 of 162 upstream skills).
