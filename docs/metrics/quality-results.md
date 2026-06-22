# Review-quality results — prompts vs. structure

A controlled measurement of two levers on the `plan-fix` / `paper-reviewer`
output: **sharper prompts** and **Stage-1A scope/section structure**. The
question is *how good is the plan* (the diffs plus per-block `reviewerNotes`),
scored by an LLM judge against a rubric grounded in Obelus's own skill criteria.
Methodology, rubric dimensions, and gating rules are in
[`quality-eval-design.md`](quality-eval-design.md); this file is the receipt.

## Method

- **Harness.** `scripts/eval-review-quality.mjs` (orchestrator),
  `scripts/lib/judge.mjs` (rubric prompts), `scripts/lib/eval-extract.mjs`
  (plan extraction). Reviews run against the **hand-authored** fixture bundles
  (`sample` / `sample-large`, the `-md` variants) — real reviewer notes, so the
  judge has editorial intent to score addressing-the-mark against.
- **Rubric.** Each substantive (patched) block on six anchored 0–3 dimensions:
  **B1** addresses-the-mark · **B2** correctness / patch-applies (gating) ·
  **B3** minimal diff · **B4** voice / no boilerplate · **B5** citation handling
  (gating, 0 or 2) · **B6** `reviewerNotes` quality. The plan as a whole on
  **P1–P4** (coverage, cascade/impact, coherence, no-spurious-edits).
- **Variance discipline.** **n=3** reviews per condition (model sampling),
  **k=3** judge passes per prompt with per-dimension **median**. The judge is
  **blind to provenance** and pinned to **opus**, held constant across arms.
- **A/B switch.** `--structure on|off` enriches the loaded bundle with
  Stage-1A `sections` / `citations` / per-anchor `scopeStart`/`scopeEnd` before
  the review reads it (`off` = baseline shape). The scope lever is a no-op
  unless `--structure on`, so it can only move scores in the treatment arm.

## Baseline — current skill, no structure

`n=3 × {small, large}/md`, opus judge, k=3 median.

**Overall: 3 pass / 2 weak.** Per soft dimension:

| dim | mean | range | reading |
|---|---|---|---|
| **B6 reviewerNotes** | **2.10** | [1–3] | **weakest** — generic / process-logging / self-contradictory notes |
| B3 minimal diff | 2.60 | [1–3] | over-edits present |
| B1 addresses mark | 2.60 | — | |
| B2 correctness | 2.80 | — | strong |
| B4 voice | 2.80 | — | strong |
| B5 citation | maxed | — | no invented citations |

`P1–P4` sit flat at 3: the 2-mark bundles don't exercise the cascade or
coherence sweeps, so the plan-level sweeps have nothing to discriminate.

## Intervention

Two levers, **prompt-only changes, coverage-neutral** (no extra blocks, no
changed mark count):

1. **Stage-1A scope-aware editing** — keep each edit within its mark's enclosing
   section, prefer the minimal span. Targets **B1 / B3**, and the **B2**
   correctness of tight edits. Requires `--structure on` to have a surface.
2. **Sharper `reviewerNotes` discipline** — critique, not process-log; three
   named anti-patterns. Targets **B6**.
3. **Marginal citation-awareness.**

## Three-way attribution

Mean per block-dimension across the three arms: **base** (current skill, no
structure) → **prompts-only** (improved prompts, `--structure off`) →
**prompts+structure** (improved prompts, `--structure on`).

| dim | base | prompts-only | prompts+structure | prompt Δ | structure Δ |
|---|---|---|---|---|---|
| B6 notes | 2.10 | 2.75 | 2.67 | **+0.65** | −0.08 |
| B1 addresses | 2.60 | 2.83 | 2.83 | +0.23 | 0 |
| B3 min-diff | 2.60 | 2.75 | 2.75 | +0.15 | 0 |
| B4 voice | 2.80 | 3.00 | 3.00 | +0.20 | 0 |
| B2 correctness | 2.80 | 2.33 | 3.00 | **−0.47** | **+0.67** |
| B5 citation | 2.00 | 2.00 | 2.00 | 0 | 0 |
| **overall** | **3p / 2w** | **4p / 2w** | **6p / 0w** | | |

## Conclusion

- **The sharper prompts drive the headline gains** — especially **B6
  reviewerNotes (+0.65)**, the weakest baseline dimension. B1, B3, B4 all rise.
- **Pushing minimal-diff *without* structure regresses correctness** — B2 falls
  −0.47 in the prompts-only arm: tighter edits, more chances to clip context or
  introduce an error with no section boundary to stay inside.
- **Stage-1A's scope/section structure recovers it** — B2 **+0.67** in the
  combined arm, back to a clean 3. The structure makes the tight edits *safe*:
  each edit stays within its mark's enclosing section.
- **The combined intervention is the clean win** — **60% → 100% pass** (3p/2w →
  6p/0w), every dimension **≥ baseline**, no regressions.

**n=3 caveat.** The B2 prompts-only regression rests on a small sample; the
mechanism (tighter spans without a boundary clip context) is coherent and the
overall shift is consistent, but treat the single-arm magnitude as indicative,
not precise.

## Banked / reusable

- **Harness** — `scripts/eval-review-quality.mjs`, `scripts/lib/judge.mjs`,
  `scripts/lib/eval-extract.mjs`.
- **Rubric** — `BLOCK_RUBRIC` / `PLAN_RUBRIC` in `judge.mjs`.
- **A/B switch** — `--structure on|off` (`enrichWithStructure`).
- **Skill improvements** — `packages/claude-plugin/skills/plan-fix/SKILL.md`,
  `packages/claude-plugin/agents/paper-reviewer.md`.

## Receipts in this directory

- **Baseline** — `2026-06-22-quality-large-md-sonnet-r{1,2,3}.jsonl` and
  `2026-06-22-quality-small-md-sonnet-r{1,2}.jsonl`.
- **Prompts-only** — `2026-06-22-quality-{small,large}-md-struct-off-sonnet-r{1,2,3}.jsonl`.
- **Prompts+structure** — `2026-06-22-quality-{small,large}-md-struct-on-sonnet-r{1,2,3}.jsonl`.
