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

## Capturing a new baseline

1. Run a real review through the desktop app against a representative paper.
2. Find the file at
   `~/Library/Application Support/app.obelus.desktop/projects/<projectId>/metrics-<sessionId>.jsonl`.
3. Copy it here as
   `<YYYY-MM-DD>-<n>marks-<label>.jsonl` (e.g. `2026-05-12-12marks-postws1.jsonl`).
4. Sanitize: replace any `/Users/<you>/…` substring with `<paper-root>`,
   `<workspace>`, or `<obelus-repo>` as appropriate. Each line must remain
   valid JSON; the easiest check is `cat file | while read l; do echo "$l" |
   node -e 'JSON.parse(require("fs").readFileSync(0))'; done`.
5. `grep -nE 'juan|/Users|/home' docs/metrics/<your-file>.jsonl` — if it
   prints anything, sanitize again. Truncated tool-input blobs sometimes end
   mid-path; strip those too.

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
