# NOTICE

Ligma bundles third-party open-source software at runtime and/or build time. The packages listed below carry notice requirements under their respective licenses. All are MIT, BSD, or Apache-2.0 compatible.

Full license texts ship with the application installer under `resources/THIRD_PARTY_LICENSES.txt` (generated at package time by the build pipeline).

## Runtime dependencies

| Package | License | Upstream |
| ------- | ------- | -------- |
| Electron | MIT | https://www.electronjs.org/ |
| React | MIT | https://react.dev/ |
| Vite | MIT | https://vitejs.dev/ |
| Zustand | MIT | https://github.com/pmndrs/zustand |
| Radix UI primitives | MIT | https://www.radix-ui.com/ |
| Tailwind CSS | MIT | https://tailwindcss.com/ |
| lucide-react | ISC | https://lucide.dev/ |
| better-sqlite3 | MIT | https://github.com/WiseLibs/better-sqlite3 |
| @anthropic-ai/claude-agent-sdk | MIT | https://github.com/anthropics/claude-code |
| @mariozechner/pi-ai | MIT | https://github.com/badlogic/pi-mono |
| pptxgenjs | MIT | https://github.com/gitbrent/PptxGenJS |

## Fonts (self-hosted via `@fontsource-variable/*`)

| Font | License | Upstream |
| ---- | ------- | -------- |
| Inter | SIL Open Font License 1.1 | https://rsms.me/inter/ |
| Geist | SIL Open Font License 1.1 | https://vercel.com/font |
| Fraunces | SIL Open Font License 1.1 | https://fonts.google.com/specimen/Fraunces |
| JetBrains Mono | SIL Open Font License 1.1 | https://www.jetbrains.com/lp/mono/ |

## Build-time / developer dependencies

| Package | License | Upstream |
| ------- | ------- | -------- |
| esbuild | MIT | https://esbuild.github.io/ |
| Turborepo | MPL-2.0 | https://turbo.build/ |
| Vitest | MIT | https://vitest.dev/ |
| Playwright | Apache-2.0 | https://playwright.dev/ |
| Biome | MIT / Apache-2.0 | https://biomejs.dev/ |

If you redistribute Ligma, include the upstream license text for each bundled package — the generated `THIRD_PARTY_LICENSES.txt` is the authoritative manifest.
