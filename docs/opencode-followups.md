# OpenCode integration — follow-ups

Living punch list of items the `opencode-engine` branch deferred, deferred deliberately, or surfaced as risks. Ordered by how likely each item is to bite a real user.

Last updated: 2026-05-06 (post-live-run-1).

## Status legend

- **🚨 Blocking** — must resolve before declaring OpenCode "supported."
- **⚠️ Likely-issue** — strong suspicion something is wrong; needs a real run to confirm or disprove.
- **🟡 Deferred** — explicit out-of-scope decision; track for a later pass.
- **🔧 Polish** — small UX or code-hygiene item.
- **📚 Docs** — branding / editorial work.
- **🧪 Coverage** — testing gap.
- **🌳 Pre-existing** — trunk debt unrelated to this branch.

---

## 🚨 Blocking — never validated live

### 1. No real `opencode run` has been issued from this branch

The Tauri commands compile, the harness lints, the types check, but no one has actually spawned OpenCode against a sample paper. Every item below in §⚠️ is an educated guess until this happens.

**To resolve:**
1. `brew install sst/tap/opencode` (or the equivalent on Linux/Windows).
2. `opencode auth login` — sign in to Anthropic.
3. Open the desktop app from this worktree (`pnpm dev:desktop`), set Settings → Preferred engine to OpenCode, start a review on the sample paper at `packages/claude-plugin/fixtures/sample/`.
4. Capture stderr (`[opencode-session]` lines), stdout (NDJSON events), and any plan files written under the workspace.
5. Use the captured stdout to confirm — or fix — items 2, 4, 5 below.

Also exercise the harness:

```
OBELUS_E2E_ENGINE=openCode pnpm e2e:plugin
```

This is the single most important follow-up. Until it happens, treat OpenCode as "wired but unverified."

---

## ⚠️ Likely-issue — needs verification against a real run

### 2. ~~Model IDs may not match OpenCode's catalog~~ ✅ Resolved by removal

The `map_opencode_model` Anthropic-prefixed mapping was removed; the desktop no longer passes `--model` to OpenCode. Users configure their default model via `opencode auth login` and `opencode.jsonc`. This avoids forcing an Anthropic dependency on users who run OpenCode against OpenAI/OpenRouter/Bedrock/Vertex.

If the desktop ever wants to expose a per-engine model picker, see polish item §22 below.

### 3. ~~Paper-reviewer subagent may never get dispatched~~ → intentionally dropped for OpenCode

Earlier this branch added `@paper-reviewer` dispatch sentences to the OpenCode prompts. They were removed because OpenCode discovers agents at `<--dir>/.opencode/agents/` (= the user's paper root), but we stage `paper-reviewer.opencode.md` at `<workspace>/.opencode/agents/` (under app-data). The reference would never resolve, and we don't want to pollute the user's project tree by staging the agent there too.

The `paper-reviewer.opencode.md` file is kept in `packages/claude-plugin/agents/` for the future `.opencode/commands/*.md` shim approach (item §7) — that path can stage commands that reference the agent without polluting the user's working tree. Until then, OpenCode runs without the per-edit critique subagent; the SKILL.md alone produces a usable plan.

### 4. ~~NDJSON event-shape tolerance is a guess~~ ✅ Resolved (desktop stream)

`opencode run --format json` emits a clean NDJSON vocabulary — `step_start`, `tool_use`, `text`, `step_finish` — disjoint from Claude Code's top-level types. The desktop's `parseStreamLine` now normalises these into Claude Code-shaped events at parse time, so phase narration ("Reading main.typ"), the `OBELUS_WROTE` matcher, and token-usage tracking all work uniformly across engines.

What changed:

- `apps/desktop/src-tauri/src/commands/opencode_session.rs::build_opencode_command` passes `--format json`. Without it OpenCode prints a TTY-formatted transcript that yields no parseable phase events and the dock sits silent.
- `packages/claude-sidecar/src/index.ts::parseStreamLine` rewrites each OpenCode event:
  - `tool_use` → `assistant` event with a single `tool_use` content block (lowercase tool names mapped to TitleCase via `OPENCODE_TOOL_NAMES`).
  - `text` → `assistant` event with a `text` content block (no deltas; OpenCode emits whole text).
  - `step_finish` with `reason: "stop"` → synthetic `result` event carrying mapped `usage` (`tokens.input/output` → `input_tokens/output_tokens`, `tokens.cache.read/write` → `cache_read_input_tokens/cache_creation_input_tokens`).
  - `step_finish` with `reason: "tool-calls"` → mid-stream `assistant` event carrying cumulative usage.
  - `step_start` → typed pass-through (watchdog still ticks).
- `apps/desktop/src/lib/claude-phase.ts::describePhase` falls back to the camelCase form of the input key (`filePath` when `file_path` is missing) so OpenCode's input shape narrates correctly without a deeper key normaliser.

`scripts/plugin-e2e.mjs::parseOpenCodeStdout` was **not** touched as part of this fix; the e2e harness still reads the default (non-JSON) transcript when running OpenCode under it. That path needs the same `--format json` plumbing if/when item §18 (CI matrix) lands. Left as a follow-up.

### 5. Slash-skill resolution is "trust the agent"

Claude Code's plugin loader resolves `/obelus:write-review` deterministically. Under OpenCode, we replaced that with English instructions that say "Read `.claude/skills/<skill>/SKILL.md` and follow it." Whether the model reliably *executes* the skill (vs. summarising it, paraphrasing it, or skipping steps) is empirical, not architectural.

**To resolve:** The smoke test (item 1) is the validation. If reliability is poor, options include:

- Inlining the SKILL.md body directly into the prompt (heavier but bulletproof).
- Authoring `.opencode/commands/*.md` shims that wrap the skill invocation (item 7).
- Using an `--agent` that's specifically configured to follow staged skills.

---

## 🟡 Deferred — explicit out-of-scope decisions

### 6. `--effort` is dropped under OpenCode

OpenCode actually does have an analogue: `opencode run --variant <high|max|minimal|...>` (provider-specific reasoning effort). The desktop currently doesn't wire this up — the `effort` parameter is accepted on the IPC for parity with `claude_spawn` but discarded.

**Resolution path:** map the desktop's `low/medium/high/xhigh/max` to OpenCode's `--variant` levels in `build_opencode_command`, dropping the per-spawn "effort ignored" log line. Verify the accepted token set first (e.g. `opencode run --variant high "hello"`), since OpenCode's variant names are provider-specific.

### 7. No `.opencode/commands/*.md` slash-command shims

We chose to surface skills via the SKILL.md path rather than authoring command files. If item 5 turns out to be unreliable, this is the fallback architecture: each user-invocable skill (`apply-revision`, `write-review`, `apply-fix`, `deep-review`, `plan-writer-fast`) gets a sibling command file.

Each `.opencode/commands/<skill>.md` would have frontmatter (`description`, `agent: paper-reviewer`, optional `model`, optional `subtask`) and a body that uses `$ARGUMENTS` to receive the bundle path.

**Resolution path:** author 5–6 command files in `packages/claude-plugin/commands/`, stage them in `opencode_session.rs::stage_opencode_resources`, update the prompt construction in each `opencode_*` Tauri command to use `/<skill> <args>` instead of the English fallback.

### 8. No OpenCode marketplace manifest

`packages/claude-plugin/.claude-plugin/plugin.json` is the Claude Code manifest. There's no sibling `.opencode-plugin/plugin.json`. Blocking only if we want users to install the plugin via OpenCode's marketplace; the desktop ships the plugin as a Tauri resource regardless.

**Resolution path:** author `.opencode-plugin/plugin.json` (research the exact schema first) and document the install command in the plugin README.

### 9. Per-spawn engine override removed by design

You picked global preference only. Switching engines for a one-off review requires a Settings round-trip. If users ask for inline override, the `engine?: AiEngineId` parameter on the sidecar inputs is already there; only the UI affordance is missing.

**Resolution path:** add an "Engine" row to the Advanced disclosure on `DrafterTab` / `StartReviewButton` / `ReviewerActionsPanel` when both engines are ready. Read once, pass through to `requireSpawnEngine()`'s call.

---

## 🔧 Polish

### 10. Effort picker shown when OpenCode is preferred

The Advanced disclosure surfaces effort even when the active engine is OpenCode (where it no-ops). Either grey it out, or add a small inline hint: "(ignored under OpenCode)".

**Files:**
- `apps/desktop/src/routes/project/StartReviewButton.tsx`
- `apps/desktop/src/routes/project/DrafterTab.tsx`
- `apps/desktop/src/routes/project/ReviewerActionsPanel.tsx`

Pattern: `engine.active?.engine === "openCode"` → render the picker disabled with a hint.

### 11. Auth never probed

Both engine panes (Folio I and Settings) say "auth — your shell, your keys" unconditionally. A user with neither engine authenticated sees "found" and only learns the truth at spawn time. Not a regression on this branch — same behaviour as before — but worth knowing.

**Resolution path:** if we want to probe, the cheapest signals are:

- Claude Code: presence of `~/.claude/auth.json` or equivalent.
- OpenCode: presence of `~/.config/opencode/auth.json` or successful `opencode auth list`.

Whether to surface "unauthenticated but installed" as a distinct status is a UX call.

### 22. Per-engine model picker in Settings

Now that the desktop never passes `--model` to OpenCode, a user who wants to override OpenCode's default has to edit `opencode.jsonc` themselves. If we want to surface this in Settings, the cleanest shape is a per-engine "Model" row that takes a free-form `provider/model` string and writes it through to `--model` for OpenCode (and as the existing label-based mapping for Claude Code).

Files: `apps/desktop/src/routes/settings.tsx`, `apps/desktop/src/store/app-state.ts` (new key `openCodeModelOverride: string | null`), `apps/desktop/src-tauri/src/commands/opencode_session.rs::build_opencode_command` (re-introduce a `model` arg).

### 12. `packages/claude-plugin` directory still says "claude"

The plugin itself is engine-agnostic (skills + agents), but the package directory name still names one engine. Renaming would touch:

- `pnpm-workspace.yaml`
- `apps/desktop/src-tauri/tauri.conf.json` (resource path)
- All `@obelus/claude-plugin` imports (none today, the package isn't a TS workspace member, but the marketplace manifest references the path).
- Marketplace identifier (`4gentic/obelus` already exists).

Defensible to leave for a "rename pass" later.

---

## 📚 Docs / branding

### 13. CLAUDE.md still names Claude Code as *the* engine

> "The reviewing is done by Claude Code" — product-in-one-sentence.
>
> Invariant #3: "the Claude Code plugin detects source format."

Both should soften to "an AI engine" / "the plugin." Light editorial pass.

### 14. README hasn't been audited for engine-neutrality

The public-facing README presumably still describes the project in single-engine terms. Walk it; replace "Claude Code" with "Claude Code or OpenCode" or "an AI engine" wherever the singular reading would mislead.

### 15. Plugin README should document OpenCode install path

`packages/claude-plugin/README.md` currently shows install via Claude Code marketplace and via copying to `.claude/plugins/obelus/`. Add a sibling section for OpenCode:

- Copy `skills/` to `.claude/skills/` (OpenCode reads this path natively).
- Copy `agents/paper-reviewer.opencode.md` to `.opencode/agents/paper-reviewer.md`.
- Authenticate via `opencode auth login` or set `ANTHROPIC_API_KEY`.

### 16. `docs/pinned-engines.md` doesn't mention OpenCode

The doc lists Typst and Tectonic. It is the right place to document OpenCode's pinned model IDs (item 2) once we settle on them, even though we don't currently auto-install OpenCode itself.

---

## 🧪 Coverage gaps

### 17. New pure functions have no unit tests

- `map_opencode_model` (Rust)
- `parseOpenCodeStdout`, `extractOpenCodeText`, `openCodePrompt`, `stageOpenCodeResources` (JS)

All amenable to small unit tests. Cheap insurance against silent regressions.

### 18. No CI matrix for `OBELUS_E2E_ENGINE=openCode`

`pnpm e2e:plugin` only runs against Claude Code in CI. Adding the OpenCode matrix needs:

- OpenCode installed in the CI container.
- `ANTHROPIC_API_KEY` secret available to the OpenCode flow (the Claude flow has its own; same secret may not work, OpenCode's auth path differs).
- Budget for real LLM calls.

Same gating shape as the Claude e2e — defensible to keep this manual until OpenCode usage is steady.

### 19. `apps/desktop/src/lib/__tests__/ai-engine.test.ts` doesn't cover `requireSpawnEngine`

We rewrote the test for the new types, but the imperative `requireSpawnEngine()` path (cache → fresh-detect → throw) isn't covered. Probably fine — it's a thin composition of `readAllEngineStatuses` and `resolveSpawnEngine`, both of which are tested — but if a regression sneaks in here, the failure mode is "spawn never throws, just hangs". Worth one happy-path + one no-engine-ready test.

---

## 🌳 Pre-existing — not from this branch

### 20. `packages/source-render/__tests__/asset-rewrite.test.ts` fails

Happy-dom v20.9.0 throws `DOMException [NotSupportedError]: Failed to load script "data:,"` when `blockExternalAssets` rewrites `<script src>` to the `data:,` placeholder. The package is untouched on `opencode-engine` (`git diff origin/main -- packages/source-render/` is empty). Same failure exists on `main`.

**Resolution path** (separate workstream):
- Pin happy-dom to ≤20.8.x in `packages/source-render/package.json` until upstream restores the previous behaviour.
- Or migrate the affected tests to jsdom for the script-rewrite path.
- Or rewrite `blockExternalAssets` to produce a non-script-loadable placeholder (e.g. `about:blank` or a marker comment in the parent).

---

## 🌐 Architectural — long-term

### 21. Engine selection lives entirely in `apps/desktop/src/`

CLAUDE.md (web/desktop parity section) says shared features must live in `packages/*`. The engine concept is desktop-only today (the web app can't spawn anyone), so the violation is theoretical. It becomes real if web ever needs to display "this review used OpenCode" or accept an external review bundle that names the engine.

**Resolution path:** if/when web grows engine awareness, extract the types and helpers (`AiEngineId`, `AiEngineStatus`, label/install-hints) to a new `packages/agent-engine/` workspace. Hooks and detection stay desktop-local (they're Tauri-coupled).

---

## Recommended order

If you want to drive this to "OpenCode is supported, period":

1. **§1** Smoke test. Capture stdout. Confirm or fix §2, §3, §4, §5.
2. **§3** Add the `@paper-reviewer` dispatch line to OpenCode prompts (likely the highest-leverage tweak after the smoke test).
3. **§10** Effort-picker grey-out — small UX honesty fix.
4. **§13–15** Editorial pass on CLAUDE.md / README / plugin README.
5. **§17, §19** Unit tests for the four pure functions and the `requireSpawnEngine` happy path.
6. **§7** Author `.opencode/commands/*.md` shims if §5 turns out to be unreliable.
7. Everything else is genuinely follow-up work.
