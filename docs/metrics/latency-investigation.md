# Review-pipeline latency investigation

A completed investigation into reducing review latency in the `plan-fix`
pipeline. The conclusion was negative-but-actionable: prompt-level latency
optimization on this pipeline is marginal and unreliable because the dominant
cost is unbounded model reasoning whose **variance is structural**, not a
property of any one prompt. We accept the latency limit for now and pivot the
performance work to quality, large-paper scalability, and latency-UX. This
file banks the diagnosis so it isn't re-derived.

## Goal

Find reliable latency wins in the review pipeline, measured with the
repeatable capture harness rather than inferred. The pipeline under test:

```
plan-fix:  preflight → locating-spans → stress-test → impact-sweep → coherence-sweep → writing-plan
```

All runs: Claude `sonnet`, effort `low`. Baselines captured at **n=3** per
condition via `scripts/capture-metrics.mjs`.

## Where the time lives (n=3 baseline)

Review latency is **~99% model reasoning**; tool I/O is ~1s per phase. The
cost concentrates in two phases.

| Phase            | Median @ 7 marks | Median @ 25 marks | Notes |
|------------------|-----------------:|------------------:|-------|
| **preflight**    | 161s             | 188s              | Dominant phase |
| **locating-spans** | 64s            | 176s              | Second-largest |
| impact-sweep     | 52s              | 125s              | Mid-pack |

Decomposition of the two dominant phases:

- **preflight** is the model **pre-planning the whole editorial brief before
  the marker** — the monolithic pre-think the Pacing rule explicitly forbids.
  This is the single largest reasoning block and the one most resistant to
  prompt control (see re-pacing experiment below).
- **locating-spans** is **~82% diff composition**. The stress-test subagent is
  only ~18% of the phase, and *locating itself is near-free* — anchors carry
  line numbers, so the model is not searching, it is writing diffs.

## The structural obstacle: variance

On *identical* input, the two dominant phases swing by an order of magnitude:

| Phase            | Min   | Max   |
|------------------|------:|------:|
| preflight        | 35s   | 393s  |
| locating-spans   | 18s   | 617s  |

This variance has two consequences, and they are the crux of the whole
investigation:

1. **Reviews are unpredictable** — some runs hit the 15-minute per-run timeout
   and produce no plan at all.
2. **The noise band buries any point-optimization.** A swing this large is
   larger than the effect size of every prompt change tried, so a change cannot
   be distinguished from chance at n=3.

## The n=1 correction (methodological lesson)

The first single-sample baseline reported **impact-sweep at 213–239s**, which
made it look like the second-worst phase and a prime optimization target. The
n=3 baseline revealed those numbers as **outliers**: the true median is
**52–125s** (mid-pack). Acting on the n=1 reading sent the first optimization
attempt down the wrong path.

This is exactly the failure CLAUDE.md's *"never act on n=1 telemetry"* rule
exists to prevent, and it is now in force for this pipeline by precedent, not
just policy.

## What was tried, and shelved (with data)

Three prompt-level changes were measured at n=3 against the baseline. All three
were shelved.

| Experiment | Branch | 7-mark result | 25-mark result | Verdict |
|------------|--------|---------------|----------------|---------|
| impact-sweep **structure-aware** — structure embedded in the bundle | `perf/impactsweep-opt1` | Better, but inside the noise band | **Worse** (median 824s vs 670s) | Shelved |
| impact-sweep **lean-prelude** — structure in a compact prelude instead | `perf/impactsweep-opt1b` | Worse | Worse; **2/3 runs hit the 15-min timeout** | Shelved |
| **phase re-pacing** — prompt forbids the preflight pre-think | `perf/phase-repacing` | — | Bounded preflight to ~101s in **2/3** of runs; ignored in **1/3** (preflight 468s → 900s timeout, no plan) | Shelved |

Detail worth keeping:

- The **lean** prelude (opt1b) was *worse than the bloated* structure-aware
  version (opt1). A leaner input producing a slower run is only explicable as
  variance — it is direct evidence that these deltas are noise, not signal.
- **Re-pacing was a real win when obeyed** (~12% median gain, preflight bounded
  to ~101s) but the model **ignored the directive 1/3 of the time**, and on
  that run produced the catastrophic outcome: a 468s preflight, a 900s total,
  and no plan. A median win with no tail fix is not shippable.

## Conclusion

Prompt-level latency optimization on this pipeline is **marginal and
unreliable**. The reason is structural: the model is reasoning inside one
large, unbounded context, and it **can ignore any prompt-level pacing
directive** — producing a catastrophic tail (timeout, no plan) that no median
improvement compensates for.

Reliably bounding the reasoning would require one of:

- **Structural enforcement** — decompose the single unbounded context into
  bounded workers, so no individual unit of reasoning can run away; or
- **Accepting** the latency as a property of the pipeline.

**Decision: accept the latency limit for now.** Pivot the performance work to
quality, large-paper scalability, and latency-UX (making the wait legible)
rather than chasing a median that the tail erases.

## Banked and reusable

The durable outputs of this investigation, all retained on this branch:

- **Capture harness** — `scripts/capture-metrics.mjs` and `scripts/lib/*`
  (`capture-bundle.mjs`, `sanitize-metrics.mjs`, `opencode-prompt.mjs`).
  Repeatable, pre-sanitized, schema-checked against `MetricEvent`.
- **n=3 baselines** — `docs/metrics/2026-06-22-large-{7,25}marks-base-r{1,2,3}.jsonl`.
- **Stage 1A structured bundle** — sections / citations / scope navigation
  hints in the review bundle (carried by this branch; landed independently of
  the latency result).
- **This diagnosis.**

The three experiment branches are kept **un-merged** for reference:
`perf/impactsweep-opt1`, `perf/impactsweep-opt1b`, `perf/phase-repacing`.
