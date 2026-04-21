# Releasing

Obelus ships two artifacts: the desktop app and the Claude Code plugin. The web app deploys continuously from `main` (see `.github/workflows/pages.yml`) and is *not* released — users never download it.

Each shippable lives as its own release-please package, so commits only trigger a release PR for the component they touch:

| Component | Path | Tag prefix | Changelog |
| --- | --- | --- | --- |
| Desktop | `apps/desktop/**` | `desktop-v*` | `apps/desktop/CHANGELOG.md` |
| Plugin | `packages/claude-plugin/**` | `plugin-v*` | `packages/claude-plugin/CHANGELOG.md` |

Commits that only touch `apps/web/**`, `packages/` (other than the plugin), docs, or CI do not open a release PR.

## Version bumps

[release-please](https://github.com/googleapis/release-please) watches `main` for Conventional Commits and opens a PR per component that bumps the relevant `version` fields and updates that component's `CHANGELOG.md`. Releases are **published on merge** (no draft step).

- **Plugin PR** bumps `packages/claude-plugin/package.json` and `packages/claude-plugin/.claude-plugin/plugin.json`. Merging it creates `plugin-v<version>` and publishes a source-only GitHub Release with the changelog — there are no binaries to build; users install the plugin from the tagged source.
- **Desktop PR** bumps `apps/desktop/package.json`, `apps/desktop/src-tauri/tauri.conf.json`, and `apps/desktop/src-tauri/Cargo.toml`. Merging it creates `desktop-v<version>` and publishes a GitHub Release with the changelog; `release-please.yml` then invokes `release.yml` via `workflow_call`, which builds binaries for macOS (arm64 + x64), Linux AppImage, and Windows via `tauri-action` and uploads them to the already-published release.

Users landing on the release page during the ~10–15 min matrix build see a release with a changelog and no binaries yet; binaries appear as each matrix target finishes.

`release.yml` is chained directly from `release-please.yml` rather than relying on the `release.published` event: releases authored by the default `GITHUB_TOKEN` do not cascade into other workflows, so an event-driven trigger would silently skip every auto-published release. The `release.published` trigger is retained as a fallback for releases published manually through the Releases UI.

### Manual backfills

If a build is missing for an already-published release, re-run the matrix directly:

```sh
gh workflow run release.yml -f tag=desktop-v<version>
```

The workflow resolves the release id from the tag and uploads assets to the existing release.

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
