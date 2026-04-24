---
name: electron-updater-missing-latest-yml
description: Diagnose why an Electron app with `electron-updater` wired up never discovers new releases even though `setupAutoUpdater()` / `autoUpdater.checkForUpdates()` is called and the packaged app lives on GitHub Releases. The silent-failure mode is almost always that the CI workflow only uploads the installer binaries (`.dmg`, `.exe`, `.AppImage`, `.deb`, `.rpm`) but forgets the `latest-*.yml` feed manifests that electron-updater polls. Also covers the `.blockmap` files that enable delta downloads. Trigger words — "electron-updater not checking", "checkForUpdates returns nothing", "auto-update not working after install", "latest-mac.yml missing", "update-available never fires", "latest.yml 404".
allowed-tools: Read, Bash, Edit, Glob, Grep
---

# electron-updater silently fails when latest-*.yml manifests aren't on the release

## The bug

Your Electron app imports `autoUpdater` from `electron-updater`, registers handlers, and schedules a check:

```ts
import { autoUpdater } from 'electron-updater';

autoUpdater.autoDownload = false;
autoUpdater.on('update-available', (info) => { ... });
autoUpdater.on('error', (err) => { ... });
autoUpdater.checkForUpdates();
```

You ship a new release via GitHub Releases. In the installed app, `checkForUpdates()` resolves without firing `update-available`, and the error log (if you're listening) shows:

```
HttpError: 404
  "method": "GET",
  "url": "https://github.com/<owner>/<repo>/releases/latest/download/latest-mac.yml"
```

The installers themselves ARE on the release. Everything else looks correct.

## Why

electron-updater discovers new versions by fetching a feed manifest per platform:

| Platform | Manifest | Where electron-builder writes it |
|----------|----------|----------------------------------|
| macOS    | `latest-mac.yml` | `<output>/latest-mac.yml` |
| Windows  | `latest.yml`     | `<output>/latest.yml` |
| Linux    | `latest-linux.yml` | `<output>/latest-linux.yml` (AppImage only) |

electron-builder generates these at package time, alongside the installer. A typical GitHub Actions release pipeline uploads only the binaries:

```yaml
- uses: actions/upload-artifact@v4
  with:
    path: apps/desktop/release/*.dmg    # binaries only!
```

The manifests stay on the runner, get discarded at job end, and never make it to the release. The installed app now has binaries it can't discover — the auto-update path points at a URL that 404s.

`.blockmap` files (`<installer>.blockmap`) are also generated and serve a different purpose: they let electron-updater compute and download only the *binary diff* between the installed version and the new one. Without them, users re-download the entire installer on every patch.

## The fix

In your release workflow, extend the artifact globs per platform to include the feed manifest and the blockmaps:

```yaml
strategy:
  matrix:
    include:
      - os: macos-latest
        artifact_glob: |
          apps/desktop/release/*.dmg
          apps/desktop/release/*.dmg.blockmap
          apps/desktop/release/latest-mac.yml
      - os: windows-latest
        artifact_glob: |
          apps/desktop/release/*.exe
          apps/desktop/release/*.exe.blockmap
          apps/desktop/release/latest.yml
      - os: ubuntu-latest
        artifact_glob: |
          apps/desktop/release/*.AppImage
          apps/desktop/release/*.AppImage.blockmap
          apps/desktop/release/*.deb
          apps/desktop/release/*.rpm
          apps/desktop/release/latest-linux.yml
```

Then the publish step uploads all of them to the GitHub Release (typically via `softprops/action-gh-release` with `files: dist/**`).

## How to confirm the fix

1. After the release workflow runs, the GitHub Release assets panel must contain: installers + `latest-*.yml` + `*.blockmap`.
2. Curl the feed manifest URL shown in the 404 — it should now return YAML with `version`, `path`, `sha512`, `releaseDate`.
3. Launch an OLDER installed copy of the app, call `autoUpdater.checkForUpdates()`, and watch for the `update-available` event.

## Related gotchas

- **`publish:` config in `electron-builder.yml` must match the release location.** If you set `provider: github, owner: foo, repo: bar`, the manifest bakes in `https://github.com/foo/bar/releases/download/...`. A mismatched owner/repo here produces manifests that 404 even when uploaded correctly.
- **Unsigned builds can silently fail to auto-update on macOS.** Gatekeeper on recent macOS versions refuses to launch updates without valid code signatures. `autoUpdater` will download the update but `quitAndInstall()` either hangs or the new binary fails on launch. Fix: sign the app, or accept that macOS users need to re-download the DMG for each update.
- **`autoDownload = false`**: with this set, the `update-available` event fires but you must call `autoUpdater.downloadUpdate()` explicitly. Easy to confuse "never fires" with "fires but nothing happens".
- **Draft releases are invisible to the updater.** If your workflow creates the release as a draft, electron-updater (which hits `/releases/latest`) won't see it until it's published.

## Platform quirks

- **DMG auto-update**: electron-updater only supports auto-update from the app installed to `/Applications`. From a mounted DMG the read-only volume blocks the staged binary write. Most projects add an in-app check that refuses to run from a DMG (see `install-check.ts` patterns) to steer users to drag-to-install.
- **AppImage**: electron-updater handles `.AppImage` updates natively — the user just restarts. `.deb` / `.rpm` are installer formats, not update targets; set `category: Graphics` and rely on the distro package manager or ship AppImage as the updateable channel.
- **Windows NSIS**: updates work for the standard installer. `oneClick: false` changes the UX (a classic wizard appears on install-update) but doesn't break the feed discovery.

## When to skip this fix

- Your app publishes via a *non-GitHub* provider (Spaces, S3, generic). The same manifest-files-must-ship principle applies, but the glob pattern lives in a different upload step.
- Your app intentionally distributes only through a store (Mac App Store, Microsoft Store, Snap Store). Those channels own updates; electron-updater is not the path.
