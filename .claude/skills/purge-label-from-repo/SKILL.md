---
name: purge-label-from-repo
description: Use when removing a label, brand, or license claim from every occurrence in a repo — e.g. "remove all mentions of X", "strip MIT license everywhere", "rebrand from Y to Z", "unlicense the project". Covers the three hiding spots natural-language greps miss.
allowed-tools: Grep, Glob, Read, Edit, Bash
---

# Purging a label from a repo

When removing every mention of a label (brand name, license, deprecated term), a prose grep like `MIT[- ]licensed|licensed under MIT|License: MIT` will miss the **encoded-string** occurrences. Three places to check that pure-prose patterns never cover.

## The three hiding spots

### 1. Asset URLs (shields.io, OG images, favicon paths)

Badge URLs concatenate the label without spaces or punctuation:

```html
<img src="https://img.shields.io/badge/license-MIT-blue" />
```

A grep for `license: MIT` or `licensed under MIT` won't catch `license-MIT-blue`. Always add a second grep pass with a **bare-word** pattern scoped to known asset hosts:

```
rg -n 'shields\.io.*MIT|badge/.*MIT' -g '!pnpm-lock.yaml'
rg -n 'og[-:].*MIT|og\.svg' <website-root>
```

Also read the actual OG/hero SVG — subtitle text inside SVGs is invisible to most `*.md` greps.

### 2. Manifest "license" fields (strict schemas)

Package manifests have *required* license fields. Removing the field breaks the manifest:

| Format | Field | If empty? |
|--------|-------|-----------|
| `package.json` (npm) | `license` | optional — delete the line |
| `*.cff` (Citation File Format) | `license` | optional — delete |
| `winget defaultLocale` | `License` | **required** — set to `Proprietary` or SPDX id, do not delete |
| `Cargo.toml` | `license` or `license-file` | optional — delete |
| scoop `bucket/*.json` | `license` | optional — delete |
| Homebrew cask `.rb` | `license` | optional — delete |

When the schema requires the field, write a neutral value (`Proprietary`, `UNLICENSED`, `LicenseRef-Custom`) rather than deleting. Verify by building/linting the manifest.

### 3. Structural markdown (comparison tables, FAQ pairs)

Prose edits can leave structural wreckage:

- **Table rows**: removing "| License | **MIT** | Closed |" leaves the column count right. Removing the *column* means editing every row in the table plus the header-separator line. Read the table first.
- **FAQ Q+A**: "**License?** MIT." is usually paired with a Q in prose above. Delete the whole line.
- **Column headers**: if a comparison table has `| Open source | ... |` and you strip "MIT" from the cell, the column still claims the *concept*. Decide: keep column and change cell ("✓") or drop column entirely.
- **Header-separator line**: the `| :-: | :-: |` alignment row must match the column count. Always re-read the table after editing.

## The verification loop

After the first pass of edits, run two greps, not one:

```
# Pass 1: prose occurrences (word-aware)
rg -i 'MIT[- ]licensed|licensed under MIT|License:\s*MIT|"license":\s*"MIT"|MIT License'

# Pass 2: bare-token occurrences in URLs/assets/manifests
rg -n 'MIT' \
  -g '*.{md,html,svg,json,yaml,yml,toml,ts,tsx,js}' \
  -g '!**/node_modules/**' \
  -g '!**/vendor/**' \
  -g '!pnpm-lock.yaml'
```

Pass 2 will hit false positives (`LIMIT`, `OMITTED`, `SUBMIT`, upstream vendor license headers). That's expected. Scan visually.

## Preserve vs purge — the distinction that matters

Before editing, separate:

- **Self-claims**: "Ligma is MIT-licensed" — purge.
- **Dependency policy**: "MIT-compatible deps only" — keep.
- **Upstream vendor headers**: `* @license MIT` in vendored React UMD — keep.
- **Attribution tables**: `NOTICE.md` listing deps and their licenses — keep.

If you purge the dep-policy mentions, you've broken the project's stated dependency constraints. If you purge vendor headers, you've violated the vendor's license.

## Concrete example — removing MIT from a repo

```bash
# 1. Enumerate all hits (both passes)
rg -i 'MIT' --glob '!pnpm-lock.yaml' --glob '!**/vendor/**'

# 2. Categorise: self-claims | dep-policy | vendor | structural

# 3. Edit self-claims:
#    - Delete LICENSE file
#    - Remove "license": "MIT" from package.json / scoop / etc.
#    - Set winget License: Proprietary (required field, can't delete)
#    - Strip "MIT-licensed" adjective from prose
#    - Delete "License" rows from comparison tables
#    - Delete "License? MIT." FAQ lines
#    - Remove shields.io badge <img> tags
#    - Edit og.svg subtitle text
#    - Remove JSON-LD `license: 'https://opensource.org/licenses/MIT'`

# 4. Verify both greps show only dep-policy + vendor hits
# 5. Run lint + typecheck
```

## When the repo is already pushed

If the cleanup is meant to erase the label from *history*, a single commit amend is insufficient — prior commits still contain the string. Collapse to a single orphan commit:

```
git checkout --orphan clean
git add -A
git commit -m "chore: initial commit"
git branch -D main
git branch -m clean main
git push --force origin main
```

Force-push is required. Safe only if you own the branch and no one has pulled.
