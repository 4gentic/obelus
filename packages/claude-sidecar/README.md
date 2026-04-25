# @obelus/claude-sidecar

**What.** The desktop-only bridge to a local Claude Code process — `spawn`, `ask`, `write-review`, `cancel`, plus stdout/stderr/exit event streams — implemented as thin wrappers over Tauri v2 IPC. (The write-review bridge is still named `claudeDraftWriteup` in code for now.)

**Why.** The desktop build runs Claude Code as a child process so that the plugin's skills can operate on the local project tree. Centralising the IPC surface means one place to validate the event shape and one place to update when the Tauri command signatures change.

**Boundary.** This package speaks to a running Claude process via `@tauri-apps/api`. It does not render UI, does not build bundles, and is never imported from `apps/web` — the web runtime has no child-process story. Event payloads are Zod-parsed before they reach callers.

**Public API.**
- `claudeSpawn`, `claudeAsk`, `claudeDraftWriteup`, `claudeCancel` — lifecycle commands.
- `onClaudeStdout`, `onClaudeStderr`, `onClaudeExit` — event subscriptions returning `UnlistenFn`.
- `PlanFileSchema`, `pickLatestPlanName` — read the plan files the plugin writes under `$OBELUS_WORKSPACE_DIR/` (the per-project workspace dir Obelus passes via env when spawning Claude Code).
- Types: `ClaudeSpawnInput`, `ClaudeAskInput`, `ClaudeDraftWriteupInput`, `ClaudeStreamEvent`, `ClaudeExitEvent`, `PlanBlock`, `PlanFile`.
