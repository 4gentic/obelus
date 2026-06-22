# Scale-gradient baseline analysis (pre-overhaul)

Captured 2026-06-21/22 on `claude` (Sonnet / low effort) via `pnpm capture:metrics`
(the repeatable harness). Two fixtures — `small` (single-file sample paper) and
`large` (single-file 15-section survey) — × {1, 7, 12, 25} marks.

**n = 1 per cell.** Treat per-cell numbers as indicative and the cross-gradient
*trend* as the signal; the reasoning phases are high-variance (see impact-sweep).
For the Stage-1 before/after verdict, run ≥2–3 repeats on the key cells to average
out variance before declaring "better."

## The gradient (phase wall-clock, seconds)

| fixture | marks | total | pre | preflight | locating | impact | coherence | writing | blocks |
|---|---|---|---|---|---|---|---|---|---|---|
| small | 1  | 100 | 5  | 22  | 25  | 32  | 7  | 9  | 2  |
| small | 7  | 251 | 4  | 70  | 79  | 38  | 18 | 43 | 8  |
| small | 12 | 267 | 4  | 84  | 60  | 43  | 24 | 51 | 11 |
| small | 25 | 333 | 16 | 83  | 103 | 40  | 23 | 67 | 13 |
| large | 1  | 121 | 5  | 47  | 13  | 33  | 7  | 17 | 2  |
| large | 7  | 465 | 6  | 96  | 118 | 213 | 18 | 15 | 8  |
| large | 12 | 401 | 7  | 171 | 101 | 44  | 24 | 54 | 13 |
| large | 25 | 644 | 4  | 117 | 151 | 239 | 37 | 95 | 27 |

`small` at 12/25 marks reuses anchors (only 8 distinct prose lines), so its nominal
mark count exceeds distinct edits — read those two cells as ~8-edit workloads.

## Findings

1. **Total wall-clock scales with marks × content.** `small` 100→333s; `large`
   121→644s. A 25-mark review of a substantial paper is **~10–11 min** today.
2. **Preflight is significant but reasoning-bound, not I/O-bound.** 22–171s, yet
   only ~3 `Read`s (bundle, one source file, SKILL). The time is model reasoning,
   not disk. On these *single-file* fixtures the read-round-trip count is tiny, so
   **Stage 1 (inline source) cannot exhibit its main lever here** — round-trip
   elimination only pays off on **multi-file projects** (the original 54-file Typst
   baseline showed preflight 274s across ~15 sequential reads). Stage 1 must be
   measured on a multi-file workload to prove its benefit.
3. **locating-spans + impact-sweep are the dominant mark-scalers, and impact-sweep
   is high-variance and can explode** — 213s (`large`/7m) and 239s (`large`/25m) vs
   44s (`large`/12m). On large papers it is frequently the single biggest phase —
   an unexpected, high-value optimization target that out-ranks preflight in several
   cells.
4. **coherence-sweep is small here (≤37s)** — unlike the original 7-mark Typst
   baseline (274s). Phase dominance is strongly workload-dependent; the original
   "coherence-bound" story does not generalize to these fixtures.
5. **writing-plan scales with block count** (9→95s).

## Implications for the overhaul

- **Stage 1 (scalable context):** the single-file after-comparison will likely show
  only a modest preflight change. Validate Stage 1 on a **multi-file fixture** (where
  preflight round-trips dominate); re-run this same single-file gradient afterward
  purely as a no-regression check.
- **impact-sweep** is a newly-surfaced, high-variance, high-cost phase — flag for
  Stage 2 / dedicated work; it may be the larger latency lever for large papers.

## Reproduce

`pnpm capture:metrics --engine claude --fixture {small|large} --marks N --label <slug>`
— see `docs/metrics/README.md`.
