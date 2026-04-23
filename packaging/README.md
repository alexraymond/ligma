# Distribution channels

Canonical sources for Ligma's package manager manifests. The `packaging/` tree is the source of truth; after each tag push `release.yml` auto-runs `update-shas.sh` and commits the synced manifests back to `main`.

All artifacts are **unsigned** for the v0.1 line. Each channel's README / caveats explains the Gatekeeper or SmartScreen workaround.

## Layout

```
packaging/
├── homebrew/
│   └── Casks/ligma.rb
├── winget/
│   └── manifests/o/TODO-MORNING/OpenCoDesign/<version>/
│       ├── TODO-MORNING.Ligma.yaml
│       ├── TODO-MORNING.Ligma.installer.yaml
│       └── TODO-MORNING.Ligma.locale.en-US.yaml
├── scoop/
│   └── bucket/ligma.json
├── flatpak/
│   └── com.ligma.app.yaml
└── update-shas.sh
```

## Release flow

1. Push a `vX.Y.Z` tag. `release.yml` builds + publishes the installers.
2. After `publish` succeeds, the **`bump-manifests`** job auto-runs `update-shas.sh`: it pulls `SHA256SUMS.txt` from the release, rewrites versions / URLs / checksums across all four channels (and auto-creates the new winget version directory by copying from the previous one), then commits the diff back to `main` as `chore(release): sync manifests to vX.Y.Z`.
3. Downstream mirroring (tap / bucket / winget-pkgs / Flathub) is still handled per-channel — see below.

To run the sync manually (e.g. to backfill a past release or test script changes):

```sh
./packaging/update-shas.sh              # uses apps/desktop/package.json version
./packaging/update-shas.sh 0.1.2        # override version
./packaging/update-shas.sh 0.1.2 ./dist # hash local artifacts instead of downloading
```

The script derives the mac `.app` bundle name and Windows `.exe` from `productName` in `apps/desktop/electron-builder.yml`, so renaming productName propagates into the cask's `app` field and the scoop `bin` automatically.

## Channel-specific mirroring

### Homebrew Cask — `TODO-MORNING/homebrew-tap`

The tap is a separate public repo. Clone it, copy `packaging/homebrew/Casks/ligma.rb` into its `Casks/`, commit, push.

```sh
# Create the tap repo once:
gh repo create TODO-MORNING/homebrew-tap --public \
  --description "Homebrew tap for Ligma and friends"
git clone git@github.com:TODO-MORNING/homebrew-tap.git /tmp/homebrew-tap
mkdir -p /tmp/homebrew-tap/Casks
cp packaging/homebrew/Casks/ligma.rb /tmp/homebrew-tap/Casks/
cd /tmp/homebrew-tap && git add -A && \
  git commit -m "ligma 0.1.0" && git push
```

Users install with:

```sh
brew tap TODO-MORNING/tap
brew install --cask ligma
```

### winget — `microsoft/winget-pkgs`

Microsoft's monorepo. Fork it, copy `packaging/winget/manifests/o/TODO-MORNING/OpenCoDesign/<version>/` into the same path in the fork, open a PR. `wingetcreate validate` is worth running first:

```sh
wingetcreate validate packaging/winget/manifests/o/TODO-MORNING/OpenCoDesign/0.1.2
```

Users install with:

```pwsh
winget install TODO-MORNING.Ligma
```

### Scoop — `TODO-MORNING/scoop-bucket`

Separate public bucket repo. Copy `packaging/scoop/bucket/ligma.json` to its `bucket/` directory.

```sh
gh repo create TODO-MORNING/scoop-bucket --public \
  --description "Scoop bucket for Ligma"
git clone git@github.com:TODO-MORNING/scoop-bucket.git /tmp/scoop-bucket
mkdir -p /tmp/scoop-bucket/bucket
cp packaging/scoop/bucket/ligma.json /tmp/scoop-bucket/bucket/
cd /tmp/scoop-bucket && git add -A && \
  git commit -m "ligma 0.1.0" && git push
```

Users install with:

```pwsh
scoop bucket add ligma https://github.com/TODO-MORNING/scoop-bucket
scoop install ligma/ligma
```

## Signing status

- macOS: **unsigned / not notarized**. On first launch Gatekeeper shows "damaged, move to Trash". Users run `xattr -d com.apple.quarantine /Applications/ligma.app`, or right-click the app and choose Open. Caveat text in the cask surfaces this.
- Windows: **unsigned**. SmartScreen will warn; users click "More info" → "Run anyway". No workaround needed beyond that.
- Linux AppImage: runs as-is.

Code signing + notarization is tracked for Stage 2 (Apple Developer ID + Windows EV cert). Once wired up, drop the Gatekeeper caveat from the cask and the SmartScreen note from the Windows READMEs.
