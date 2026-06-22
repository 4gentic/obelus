# Review-quality evaluation — methodology (plan track)

The latency harness (`scripts/capture-metrics.mjs`) answers *how fast is a
review?* This harness answers *how good is the review's output?* — where the
output is the **plan**: the diffs the planner proposes plus the per-block
`reviewerNotes`. It scores that output with an LLM judge against a rubric
grounded in Obelus's own skill criteria, with a methodology that controls for
both the review's variance and the judge's variance.

Entry points: `pnpm eval:quality` / `pnpm eval:quality:selftest`. The
orchestrator is `scripts/eval-review-quality.mjs`; the rubric prompts are in
`scripts/lib/judge.mjs`; extraction is `scripts/lib/eval-extract.mjs`.

## Scope: plan-first, hand-authored bundles only

Quality is measured against the **hand-authored** fixture bundles, whose marks
carry real reviewer notes:

| `--fixture` | `--bundle md` (canonical) | `--bundle full` |
|---|---|---|
| `small` | `fixtures/sample/bundle-md.json` | `fixtures/sample/bundle.json` |
| `large` | `fixtures/sample-large/bundle-md.json` | `fixtures/sample-large/bundle.json` |

The `md` variants are all-source-anchored against the staged `sample.md`, so
every block's patch can be matched back to real source. The `full` variants
carry PDF/HTML-anchored marks against source files that do not exist in the
text-only staged project (`main.tex`, `notes/intro.tex`, `preview.html`); those
marks may resolve `ambiguous`. Default is `--bundle md`.

**Why not the synthetic marks the latency harness generates?** Those notes are
generic filler (`"Capture mark (rephrase): …"`, empty context) — fine for
timing, useless for quality, because there is no editorial intent to satisfy
and therefore nothing for the judge to score addressing-the-mark against. The
matching fixture source is staged into the scratch project exactly as the
latency harness already does (`cpSync`), so the same desktop-shaped spawn runs;
only the bundle differs (hand-authored, not synthesised).

The **letter track** (scoring `write-review`'s reviewer letter) is deferred;
this harness is plan-only.

## The rubric — grounded in `plan-fix` / `paper-reviewer`, not invented

Each substantive (patched) block is scored on six dimensions, each on an
anchored **0–3** scale; the plan as a whole on four. The full level
descriptions are in `scripts/lib/judge.mjs` (`BLOCK_RUBRIC` / `PLAN_RUBRIC`) —
they are interpolated verbatim into the prompt and ARE the rubric.

Per-block dimensions (each traces to a skill rule):

- **B1 — addresses the mark.** `paper-reviewer` Q1. A correct one-word edit
  that fully answers the note scores 3.
- **B2 — correctness / no new error (gating).** `paper-reviewer` Q2 plus
  *does the patch apply* — 0 if it introduces a factual/logical error, an
  unsupported new claim, or its context/deletion lines do not match the source.
- **B3 — minimal diff.** `plan-fix` Edit-shape ("a single word swap beats a
  rewritten paragraph").
- **B4 — voice / no boilerplate.** `paper-reviewer` Q3 — hedging triads, empty
  intensifiers, throat-clearing, academese drift.
- **B5 — citation handling (gating; scored 0 or 2 only).** Inventing a citation
  = 0 = a gating failure. Using the format-appropriate TODO placeholder
  (`\cite{TODO}`, `[@TODO]`, `#emph[(citation needed)]`,
  `<cite>(citation needed)</cite>`), or introducing no claim that needs one,
  = 2. There is deliberately no middle value: a fabricated reference is
  categorically disqualifying, not a matter of degree.
- **B6 — reviewerNotes quality.** Reads like the `paper-reviewer` critique:
  specific, ≤6 sentences, names the judgement, no vague approval, no
  counter-rewrite.

Plan-level dimensions:

- **P1 — coverage.** Did every substantive mark get a block? The count is
  **mechanical** — computed by set-difference in `eval-extract.mjs` and
  **supplied** to the judge, which confirms rather than recounts. (Substantive
  = `remove`/`elaborate`/`rephrase`/`improve`/`wrong`/`weak-argument`; `praise`
  and `note` do not demand edits.)
- **P2 — cascade / impact accuracy.** `plan-fix` Impact sweep — propositional
  changes flagged, lexical/structural changes cascaded, nothing spurious.
- **P3 — coherence.** `plan-fix` Coherence sweep — edits consistent with each
  other (no terminology drift, notation clash, duplicate definitions, tone
  drift).
- **P4 — no spurious edits.** No edit without a mark behind it; praise left
  intact; nothing invented.

### Anti-verbosity (binding)

The prompt states explicitly: a one-word/one-token diff that **fully** satisfies
the mark scores 3 on **both** B1 and B3. Longer is not better; a larger edit
than the mark needs **loses** points on B3. This is written into the rubric so
the judge cannot reward padding — the failure mode where "more thorough-looking"
output scores higher than a correct minimal edit.

## Aggregation — explicit rules, not a vibe

Computed in `judge.mjs::computeOverall`:

- **Ordinary dims** (B1, B3, B4, B6; P2, P3, P4 and P1) → **mean**.
- **Gating dims** (B2, B5) → **MIN across blocks** — the worst block dominates,
  never averaged away.
- **B5 = 0 on any block** (an invented citation) **caps the plan `overall` at
  `fail`**, regardless of every other score.
- The blended 0–3 score thresholds: `≥ 2.5 → pass`, `≥ 1.5 → weak`, else
  `fail`. The blend folds the block ordinary-mean, the two gating mins, and the
  plan ordinary-mean so a single broken block pulls the verdict down even when
  the means look healthy.

The `quality-block` event records each block's `dims` and the `gated` list; the
`quality-plan` event records the plan `dims`, the aggregated `overall`, and the
mechanical `coverageDropped` ids.

## Variance discipline — n≥3 reviews × k=3 judge passes

Two independent sources of noise, two controls:

- **Review variance.** The same bundle reviewed twice produces different plans
  (model sampling). `--runs N` (N ≥ 3, enforced) repeats the review; each repeat
  writes its own `…-r<n>.jsonl`. Per CLAUDE.md's measurement rule, never act on
  n=1.
- **Judge variance.** The same plan judged twice can score differently.
  `--passes K` (default 3) calls the judge K times per prompt and takes the
  **per-dimension median**, so a single judge wobble cannot move a score.

The judge is **blind to provenance** — nothing in what it sees names the model,
branch, run index, or timing of the review under test (that lives only in
`quality-run`, never in the prompt). The judge model is pinned via `--judge`
(default the strongest available, `opus`) and held constant across a
before/after comparison; the diff between the two `quality-*` snapshots is the
receipt, exactly as for the latency gradient.

The judge runs one-shot via `claude --print --tools "" --model <judge>` — no
tools, no Obelus plugin. (The claude CLI exposes no `--temperature` flag, so
the median-of-k is the operative variance control; the prompt additionally
instructs deterministic, anchor-literal scoring.)

## The `--structure` A/B switch — Stage-1A on vs. off

The hand-authored fixture bundles deliberately carry **no Stage-1A structure**:
no `project.files[].sections`, no top-level `citations`, no per-source-anchor
`scopeStart`/`scopeEnd`. They are the *baseline* shape. `--structure on|off`
(default `off`) controls whether the harness enriches the loaded bundle with
that structure **before writing the bundle the review reads**:

- `--structure off` (default): the bundle reaches the engine exactly as
  hand-authored — no sections, no scope, no citations. This is the **baseline
  arm**.
- `--structure on`: the harness runs the production `bundle-builder` extractors
  (`extractSections` / `extractCitationKeys` / `buildCitationIndex` /
  `scopeForLine` — the same code path the desktop's exporter uses) on the staged
  fixture source and populates `project.files[].sections`, top-level `citations`
  (when the source cites anything), and `scopeStart`/`scopeEnd` on every source
  anchor. The enriched bundle is re-validated through the `Bundle` schema and
  re-serialised, so both the on-disk bundle and the prelude (rendered from the
  same `run.bundle`) carry the structure. This is the **treatment arm's input**.

The enrichment lives in `eval-review-quality.mjs::enrichWithStructure`; it
mirrors `bundle-builder`'s `extractStructure` + `withScope` rather than
re-deriving the whole `BuildBundleInput`, so the fixtures' hand-authored marks
are preserved untouched and only the optional structure fields are added. It
logs once (`[eval-quality:structure] { filesWithSections, sectionCount,
citationKeys, scopedAnchors }`) before returning.

The structure-aware skill change (Stage-1A scope-aware editing → B1/B3) is a
no-op when the bundle carries no `scope*`/`sections`, so it cannot help the
baseline; it can only move scores when the bundle is structure-enriched.
Therefore the two arms of the structure-aware A/B are:

| Arm | Skill | Bundle |
|---|---|---|
| **Baseline** | `perf/quality-eval` (current `plan-fix`) | `--structure off` (or absent) |
| **Treatment** | `perf/quality-structure-edits` (improved `plan-fix` + `paper-reviewer`) | `--structure on` |

The output filename carries `struct-on` / `struct-off`
(`<date>-quality-<fixture>-<bundle>-struct-<on|off>-<reviewModel>-r<n>.jsonl`)
so the two arms' snapshots never collide and the diff between them is the
receipt. Pin `--judge` across both arms exactly as for the latency gradient.

The two `reviewerNotes`/citation levers (B6 sharpening, citation-awareness) are
prompt changes that help regardless of `--structure`; the scope lever (B1/B3) is
the one that *requires* `--structure on` to have any surface to act on. Running
the treatment arm with `--structure on` exercises all three at once.

## Harness flow

```
resolve hand-authored bundle (validate against Bundle schema)
  → setupScratch: stage fixture source + write the bundle  (reused from capture-metrics)
  → runEngine: desktop-shaped claude spawn, --keep-tmp      (reused from capture-metrics)
  → plan-<iso>.json                                          (parsed via reused PlanFileSchema)
  → extractPlan: join annotationIds → marks; reconstruct each block's source
      span by matching its patch context/deletion lines against the staged
      source; compute mechanical P1 coverage (set-difference)
  → judge: k=3 per block (B1–B6) + k=3 plan-level (P1–P4), per-dim median
  → aggregate: mean / MIN-gating / B5=0 cap → overall
  → emit quality-block / quality-plan / quality-run through the SAME
      validate→sanitize→gate path as capture-metrics
  → docs/metrics/<date>-quality-<fixture>-<bundle>-<reviewModel>-r<n>.jsonl
```

Judge rationales are truncated to ~200 chars and passed through the path
sanitizer before they reach any log line — they may quote a patch that embeds a
scratch path. They are a debugging aid only; the on-disk schema has no rationale
field, so they never enter the committed JSONL.

## Tracing

`extractPlan` is an ingest boundary (an engine-written plan becomes internal
rows). It logs once, structured, before returning — `[eval-extract] { blockCount,
scorableCount, substantiveMarks, coveredMarks, coverageDropped, droppedJoins,
spanMisses }` — and never drops a row silently: a block referencing an unknown
mark id, or a patch whose lines do not match the source, is surfaced by name /
count, not hidden.

## Self-test (`--dry-run`, no quota)

`pnpm eval:quality:selftest` asserts, with no engine and no judge call (a
deterministic in-process judge runner stands in):

1. the hand-authored `small/bundle-md.json` parses and carries real notes (not
   synthetic capture filler);
2. a representative two-block plan extracts — both spans reconstruct against the
   staged source, coverage is mechanical, P1 = 3;
3. the rubric aggregation applies the **B5=0 gating override** — an
   invented-citation block caps `overall` at `fail` — and a counter-check shows
   an all-clean plan passes (the cap is the citation, not a blanket fail);
4. the new `quality-block` / `quality-plan` / `quality-run` events conform to
   the `MetricEvent` union;
5. the sanitizer scrubs a machine path embedded in a (truncated) judge
   rationale;
6. the full serialize→gate path passes on the assembled snapshot;
7. the **`--structure on` switch** populates real Stage-1A structure: for both
   the `small` and `large` md fixtures it asserts the baseline carries no
   sections/scope, then that enrichment adds non-empty `project.files[].sections`
   and scopes every source anchor (each scope range actually enclosing its
   anchor line), the enriched bundle round-trips the `Bundle` schema, and
   `citations` is populated for the cited (`large`) fixture and correctly absent
   for the uncited (`small`) one.
