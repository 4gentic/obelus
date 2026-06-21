# Review-session telemetry baselines

This directory holds JSONL snapshots of review-session telemetry from real
runs. Each file is one Claude review session — every event the desktop emits
into `<workspace>/metrics-<sessionId>.jsonl` while the session is live, plus
the `phase` / `phase-tokens` / `tool-call` events derived from Claude's
stdout stream and the `apply` / `plan-stats` events written when the plan is
ingested.

## What's here

- `2026-04-27-1mark-baseline.jsonl` — single-mark "praise" review against the
  Negotiated Autonomy short paper. Phase share is dominated by preflight
  (~70%) because there is one mark and no coherence sweep.
- `2026-04-27-7marks-baseline.jsonl` — seven-mark mixed-category review
  against the same paper after WS3 telemetry landed. Phase share shifts
  toward coherence-sweep (~37%) and locating-spans grows with the mark
  count.

Both files are sanitized: real machine paths (`/Users/<name>/…`,
workspace, plugin install dir, paper repo) are rewritten to placeholders
(`<paper-root>`, `<workspace>`, `<obelus-repo>`). Session UUIDs are kept
intact — they're not path leaks and the JSONL stays internally consistent.

Two caveats when diffing these against a fresh harness capture: (1) they predate
the harness, so they carry no `anchor-resolution` event (the harness emits one,
right after `bundle-stats`); (2) their `plan-stats.byCategory` uses the older
`unclear` key — the current `MetricEvent` schema renamed it to `rephrase`, which
is what a new capture emits. Neither is a regression; the harness tracks the
current schema in `apps/desktop/src/lib/metrics.ts`.

## Capturing a new baseline

Use the capture harness — one command runs a review at N marks against a chosen
fixture for a chosen engine and writes a **pre-sanitized** snapshot here. It
reuses the desktop's own `MetricsStream` parser and the bundle/plan Zod
schemas, so the output matches what the desktop emits for the same run.

```sh
# claude, small fixture, 7 marks → docs/metrics/<today>-7marks-baseline.jsonl
pnpm capture:metrics --engine claude --fixture small --marks 7 --label 7marks-baseline

# opencode, large fixture, 25 marks
pnpm capture:metrics --engine opencode --fixture large --marks 25 --label 25marks-opencode
```

Flags: `--engine claude|opencode`, `--fixture small|large|<abs paper dir>`,
`--marks N`, `--label <slug>` (names the file `<YYYY-MM-DD>-<label>.jsonl`),
`--out <dir>` (default this directory), `--keep-tmp` (preserve the scratch
project/workspace for inspection). `small` is the shared `sample.md` (~8 prose
spans, right for 1–7 marks); `large` is `fixtures/capture/large.md` (~18 spans,
for 12–25). Marks are synthesised with **source anchors**, so a given
`(fixture, N)` always produces the same bundle — see the script header for the
rationale.

**Dry self-test (no engine, spends no quota):**

```sh
pnpm capture:metrics:selftest      # = capture:metrics --dry-run
```

It asserts the fixture resolves, the N-mark bundle synthesises and validates
against the bundle schema, the boundary events conform to `MetricEvent`, the
`plan-stats` derivation matches `jobs-listener.tsx`, and the path sanitiser
scrubs a sample machine path. Run it after touching the harness or the metric
schema.

### Capturing the full gradient

The capture gradient is **{1, 7, 12, 25} marks × {small, large} × {claude,
opencode}**. Use `small` for 1 and 7 marks, `large` for 12 and 25 (it has the
span density to support them). A bash loop:

```sh
for engine in claude opencode; do
  for n in 1 7; do
    pnpm capture:metrics --engine "$engine" --fixture small --marks "$n" \
      --label "${n}marks-small-${engine}"
  done
  for n in 12 25; do
    pnpm capture:metrics --engine "$engine" --fixture large --marks "$n" \
      --label "${n}marks-large-${engine}"
  done
done
```

Each run spawns a **real** engine session (it spends quota / counts against your
plan's rate limits) and takes minutes — see "Prerequisites" below. Capture a
"before" gradient ahead of a workstream and an "after" gradient once it lands;
the diff is the receipt.

### Prerequisites for a real capture

- The engine CLI on PATH: `claude` (`npm i -g @anthropic-ai/claude-code`) or
  `opencode` (`brew install sst/tap/opencode`). The harness probes
  `--version` and aborts with an install hint if missing.
- **Auth.** Claude: either `ANTHROPIC_API_KEY` (metered) or a logged-in
  subscription (`claude /login` once). OpenCode: `ANTHROPIC_API_KEY` or
  `opencode auth login`. The harness inherits the ambient environment — it does
  not manage auth.
- **Cost / wall-clock.** A capture is one full review (preflight → locate →
  sweeps → plan). Expect a few minutes per run on the small fixture and longer
  as marks climb; the per-run timeout is 15 minutes. There is no built-in
  budget cap — set `ANTHROPIC_API_KEY` spend limits on your account if metered.

### Sanitisation (already applied)

The harness scrubs every emitted line before writing: the scratch workspace →
`<workspace>`, the paper dir → `<paper-root>`, the repo/plugin dir →
`<obelus-repo>`, then a generic `/Users/<name>` · `/home/<name>` ·
`C:\Users\<name>` → `<home>` fallback and a hostname → `<host>` sweep
(`scripts/lib/sanitize-metrics.mjs`, unit-tested under `node --test`). A hard
gate refuses to write the file if any line still leaks a machine path. Session
UUIDs are kept intact — they are not path leaks and keep the JSONL internally
consistent. As a belt-and-braces check before committing:

```sh
grep -nE '/Users/|/home/' docs/metrics/<your-file>.jsonl   # must print nothing
```

## The measurement rule

Phase-share distributions are workload-sensitive. A 1-mark run is
preflight-bound; a 12-mark run is coherence-sweep-bound. **Never act on n=1
telemetry for a prompt-rewrite or skill-restructuring decision** — pair every
optimization claim with at least one multi-mark baseline (say, `n >= 5`) so
you're not optimizing a workload that doesn't exist in the wild. The
canonical example: between the 1-mark and 7-mark runs above, preflight share
dropped from 70% to 23% and coherence-sweep grew from 0 to 37%. Optimizing
the 1-mark file alone would have mis-prioritized the work.

## Schema

Event shapes are the canonical `MetricEvent` discriminated union in
[`apps/desktop/src/lib/metrics.ts`](../../apps/desktop/src/lib/metrics.ts).
Read that file before adding a new event type — the Zod schemas double as
the on-disk contract.
