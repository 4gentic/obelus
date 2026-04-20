# @obelus/desktop

**What.** The Obelus Tauri v2 desktop shell. Wraps the same React renderer the web app uses, adds project folders, source editing, in-app diff review, stack-paper reviewing, and draft write-ups — with native filesystem access and a bundled SQLite library.

**Why.** Web apps can't touch the filesystem, and papers live in repos on disk. The desktop shell gives the reviewer direct access to `.tex` / `.md` / `.typ` sources, a local project library, and in-app spawning of Claude Code for applying the review — no context switching.

**Boundary.** Everything offline. Tauri CSP is strict-same-origin with no `unsafe-eval`. Filesystem access is scoped per project via `src-tauri/src/commands/fs_scoped.rs`. The Tauri updater refuses manifests until `plugins.updater.pubkey` is configured (`src/lib/updater.ts` returns `unconfigured` and the settings UI hides the control). No runtime network calls beyond the updater's own manifest poll.

**Public surface.** Target platforms: macOS (arm64 + x64), Windows x64, Linux x64 AppImage. Release is tag-triggered (`v*`) via `.github/workflows/release.yml`. See [`docs/RELEASING.md`](../../docs/RELEASING.md) for the updater keypair + signing-secret setup.

**Develop.**

```sh
pnpm dev:desktop       # Tauri dev (requires Rust toolchain)
pnpm build:desktop     # production bundle
```
