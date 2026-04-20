# Releasing

Desktop releases are triggered by pushing a `v*` tag. `.github/workflows/release.yml` builds for macOS (arm64 + x64), Windows x64, and Linux x64 AppImage via `tauri-action`, uploads artifacts to a draft GitHub Release, and flips it to public when all targets succeed.

## Version bumps

[release-please](https://github.com/googleapis/release-please) watches `main` for Conventional Commits and opens a PR that bumps the relevant `version` fields (`package.json`, `Cargo.toml`, `tauri.conf.json`) and updates `CHANGELOG.md`. Merging that PR:

1. Creates a `v<version>` git tag.
2. Drafts a GitHub Release with the generated changelog.
3. Triggers `.github/workflows/release.yml` — the matrix build for all three platforms.

## One-time setup — updater keypair

The Tauri updater verifies each update manifest with a minisign public key embedded in the app. Until the pubkey is populated, the in-settings "Check for updates" control surfaces an **Updater not configured** notice and never downloads.

Generate the keypair:

```sh
pnpm -C apps/desktop tauri signer generate -w ~/.tauri/obelus-updater.key
```

Then:

1. Paste the **public** key into `apps/desktop/src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.
2. Add the **private** key and its password as GitHub Actions secrets named `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The release workflow picks them up automatically.

OS-level code signing (Apple Developer, Microsoft Authenticode) is not in v1. Unsigned builds ship with the first-launch instructions below.

## First-launch notes for end users

Desktop builds are unsigned in v1:

- **macOS** — "cannot be opened because it is from an unidentified developer". Right-click the app → **Open** once, and macOS remembers.
- **Windows** — SmartScreen shows "Unrecognized app". Click **More info** → **Run anyway**.
- **Linux** — AppImages run directly.

Signed releases are planned post-v1.
