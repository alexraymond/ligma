# Design Systems

Each subfolder is a portable design-system package. Selecting one from the
Design System surface or a supported project-creation workflow composes its
design context into the agent prompt.

The bundled catalog currently contains **152 packages** (`ls design-systems |
grep -v _schema | grep -v README.md | grep -v LICENSE | wc -l` — recount from
disk rather than trust this number; it has drifted before). Every bundled package
has the same minimum machine-readable shape:

```text
design-systems/<slug>/
├── manifest.json
├── DESIGN.md
└── tokens.css
```

- `manifest.json` owns stable discovery metadata, provenance, and declared
  package paths.
- `DESIGN.md` is the canonical design prose for agents.
- `tokens.css` is the canonical compiled semantic-token stylesheet.

The daemon still discovers legacy folders that contain only `DESIGN.md`, so
older and user-installed content remains compatible. That fallback is not the
authoring target for new repository content.

## Manifest and catalog behavior

The v1 manifest uses fixed canonical file names:

```json
{
  "schemaVersion": "od-design-system-project/v1",
  "id": "acme",
  "name": "Acme",
  "category": "Productivity & SaaS",
  "description": "A concise English catalog summary.",
  "source": {
    "type": "bundled",
    "origin": "OpenDesign curated bundled fixture"
  },
  "files": {
    "design": "DESIGN.md",
    "tokens": "tokens.css"
  }
}
```

- The folder slug and `manifest.id` must match and use normalized ASCII.
- `files.design` is `DESIGN.md`; `files.tokens` is `tokens.css`.
- `name`, `category`, and `description` are the primary packaged-catalog copy.
- `source` records package provenance.
- Every declared path must be safe, relative, and present.

At runtime, manifest metadata takes precedence over the legacy Markdown H1 and
`> Category:` conventions. Those Markdown conventions remain readable fallback
metadata for legacy packages. There is no separate `docs/design-systems.md` in
this repo — [`_schema/AGENTS.md`](_schema/AGENTS.md) is the authoring/review
reference; this README and that file are the whole contract.

The catalog is scanned on every `/api/design-systems` request. After changing a
package, refresh the Design System surface; a daemon restart is not required.

## Rich package files

Packages may declare the richer files below through their corresponding
manifest fields:

```text
USAGE.md                     agent-facing read order and usage guide
components.html              standalone component fixture
components.manifest.json     derived component/token index
design-tokens.json           derived Design Tokens JSON
tailwind-v4.css               derived Tailwind v4 mapping
assets/                       optional static assets
fonts/                        optional webfonts
preview/                      indexed preview pages
source/                       importer evidence, snippets, and token reports
```

These fields are active runtime inputs, not structural placeholders. Prompt
composition consumes `USAGE.md`, `tokens.css`, component information, import
mode, craft bindings, and a manifest-derived pull index when present. Package
and static-file APIs expose declared preview/source files without widening the
filesystem boundary.

Derived files are caches rather than competing sources of truth:

- `components.manifest.json` is derived from `components.html` and `tokens.css`.
- `design-tokens.json` is derived from the token-contract report and must agree
  with `tokens.css`.
- `tailwind-v4.css` is derived from `tokens.css`.

The manifest and package-quality guards validate the declared paths, rich
profile, derived-file parity, token contract, component fixture, source
evidence, and preview coverage. Read
[`_schema/AGENTS.md`](_schema/AGENTS.md) before editing those contracts.

## Writing a package

`DESIGN.md` does not use a fixed nine-section template. The package-quality
guard requires at least seven substantive H2 headings for migrated packages,
without prescribing their names, order, or numbering. Use headings that fit the
actual system and keep their decisions synchronized with `tokens.css`.

For new repository content:

1. Create the three required files and keep the folder slug equal to
   `manifest.id`.
2. Record useful catalog metadata and source provenance in `manifest.json`.
3. Write at least seven substantive H2 sections in `DESIGN.md`.
4. Bind the shared semantic-token contract in `tokens.css`.
5. Add rich package files when the system needs components, previews, assets,
   fonts, or source evidence.
6. Run `pnpm typecheck` (there is no separate `pnpm guard` script in this
   repo's root `package.json` — package-quality validation for rich fields is
   whatever `_schema/AGENTS.md` currently documents as checked).

The complete authoring guide and review checklist are in
[`_schema/AGENTS.md`](_schema/AGENTS.md).

## Importing and refreshing

The write path in this repo is the **design-system wizard**, not a CLI:
`POST /api/design-systems/wizard/create-from-tokens` writes a package to
`<LIGMA_DATA_DIR>/design-systems/<id>` (never into this checkout — see
`docs/DECISIONS.md` 2026-08-13), which `GET /api/design-systems` then serves
as an overlay on top of this vendored catalog. `POST
/api/design-systems/wizard/extract-brand` powers the wizard's "start from a
website" step (measures a live page's CSS; invents nothing it didn't read).
Both are exposed from the Library's "New design system" flow in the web app.

There is no `od design-systems import-*` CLI and no
`scripts/sync-design-systems.ts` in this repo — those describe a different
(upstream or planned) import mechanism. If you're vendoring a new *bundled*
package into this directory (as opposed to a user writing their own via the
wizard), do it by hand following "Writing a package" above.

## Attribution

Package-level `manifest.source`, evidence files, and local license files are the
source of truth for provenance. Major upstream sources represented in the
catalog include:

- [`VoltAgent/awesome-design-md`](https://github.com/VoltAgent/awesome-design-md)
  (MIT) for upstream-derived product systems.
- [`bergside/awesome-design-skills`](https://github.com/bergside/awesome-design-skills)
  for normalized design-skill systems.
- [`tw93/kami`](https://github.com/tw93/kami) (MIT) for the `kami` package.
- [`Tom-Opencart/tom-modern-html-style-rule`](https://github.com/Tom-Opencart/tom-modern-html-style-rule)
  (MIT) for the `tom-modern` package.

Brand-referencing packages are aesthetic inspirations, not official assets of
the brands they reference.
