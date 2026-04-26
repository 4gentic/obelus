# Writer-flow performance — measurement & before/after

The desktop writer flow now exposes per-step timing logs you can grep out of the devtools console (and the Tauri stderr, for the spawn wall-clock). This file documents what each log means and how to record before/after numbers when you ship a change to the writer pipeline.

## What gets logged

All per-step facts emit on `console.info("[write-perf]", { step, ms, … })`. Aggregate per-session totals emit on `console.info("[review-timing]", { … })` at exit. The Rust subprocess also emits a wall-clock summary on stderr as `[claude-session] sessionId=… totalMs=…`.

| Tag | Source | Step | What it measures |
|---|---|---|---|
| `[write-perf]` | review-runner.tsx | `bundle-build` | Walking annotations, resolving source anchors, building the bundle in memory. |
| `[write-perf]` | review-runner.tsx | `bundle-flush` | `fsWriteBytes` of the bundle JSON to `.obelus/bundle-*.json`. |
| `[write-perf]` | review-runner.tsx | `prior-context` | `repo.papers.get` + `buildPriorDraftsPrompt` (now parallel). |
| `[write-perf]` | review-runner.tsx | `spawn` | `claudeSpawn` IPC roundtrip; also reports `clickToSpawnMs`. |
| `[write-perf]` | ingest-plan.ts | `ingest:hint` | Read the plan file via the `OBELUS_WROTE:` hint path; reports `picked: bool`. |
| `[write-perf]` | ingest-plan.ts | `ingest:scan` | Fallback dir scan over `.obelus/plan-*.json` (only fires when the hint path missed or was unreadable). |
| `[write-perf]` | jobs-listener.tsx | `ingest` | The full ingest call (`ingestReview` or `ingestWriteup`) wall-clock. |
| `[review-timing]` | jobs-listener.tsx | (per-session) | `totalMs`, `clickToFirstStdoutMs`, `clickToFirstObelusPhaseMs`, `phases[]`, model, token usage. |
| `[claude-session]` | claude_session.rs | `firstStdoutMs` | Wall-clock from spawn to the first stdout line — Claude Code's own startup cost. |
| `[claude-session]` | claude_session.rs | `totalMs` | Wall-clock from spawn to subprocess exit. |
| `[obelus:phase]` | plan-fix / plan-writer-fast | (named) | The plugin's own section markers (`gather-context`, `writing-plan`, `locating-spans`, `stress-test`, `impact-sweep`, `coherence-sweep`, `quality-sweep`). The desktop turns each transition into a `[phase]` log with `elapsedMs`. |

## How to capture a run

1. Start the desktop (`pnpm dev:desktop`).
2. Open devtools (Cmd-Opt-I).
3. Open a writer-mode project, attach 8–12 annotations to one paper, click **Start review →** in **Fast** mode (the new default).
4. Wait for the plan-review pane to render.
5. In the console, filter by `[write-perf]`, `[review-timing]`, `[phase]`. Copy the lines.
6. In the Tauri stderr (the terminal where `pnpm dev:desktop` is running), find `[claude-session] sessionId=<X> firstStdoutMs=…` and `[claude-session] sessionId=<X> totalMs=…` for the same `sessionId`.

## Recording the result

Use the table below for each measurement. Fill in **Fast** and **Rigorous** columns by re-running step 3 with the selector flipped.

| Phase | Fast (ms) | Rigorous (ms) |
|---|---:|---:|
| `bundle-build` | | |
| `bundle-flush` | | |
| `prior-context` | | |
| `spawn` (IPC) | | |
| `clickToSpawnMs` | | |
| `clickToFirstStdoutMs` | | |
| `clickToFirstObelusPhaseMs` | | |
| Plugin phase: `gather-context` (Fast) / `locating-spans` (Rigorous) | | |
| Plugin phase: `stress-test` | — | |
| Plugin phase: `impact-sweep` | — | |
| Plugin phase: `coherence-sweep` | — | |
| Plugin phase: `quality-sweep` | — | |
| Plugin phase: `writing-plan` | | |
| `ingest` | | |
| **`totalMs` (click → done)** | | |

Phases marked `—` for Fast do not run by design — that is the trade.

## What "before" looks like

Before this change, the only writer-flow run was what Fast now calls **Rigorous**: `apply-revision` → `plan-fix` with stress-test + impact + coherence + quality sweeps on Sonnet. Capture today's `totalMs` for a typical writer-mode pass and record it as the baseline:

| Run | totalMs (ms) | Notes |
|---|---:|---|
| Baseline (pre-change, Sonnet, all sweeps) | | git rev = `<sha>` |
| Fast (Haiku, no sweeps) | | git rev = `<sha>` |
| Rigorous (Sonnet, all sweeps) | | git rev = `<sha>` |

A 3× speedup for Fast vs Baseline on a 10-annotation `.md` paper is the design target. Capture the actual ratio in the Notes column.

## How to compare baseline against `main`

If you have not yet captured a baseline and want one against pre-change `main`:

```bash
git stash               # park the writer changes
# rebuild + run desktop, run a writer pass on the fixture, record totalMs
git stash pop           # restore
# rebuild + run desktop, run the same pass in Fast and Rigorous
```

The fixture for a comparable run lives at `packages/claude-plugin/fixtures/sample/bundle.json` (sample bundle the e2e suite uses). Use that or any 8–12-annotation writer bundle on a real paper in your Library.
