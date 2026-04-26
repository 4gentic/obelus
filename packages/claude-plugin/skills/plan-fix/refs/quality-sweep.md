# Quality sweep

Every apply-revision run also asks: *beyond the marks the reviewer wrote, what would the author have fixed given another afternoon with the paper?* This sweep surfaces those edits. They are not a replacement for the reviewer's marks — they sit alongside them in the plan, each as its own `quality-*` block the user can accept, reject, or ignore from the diff-review UI. The goal is a 5-star paper, not minimal churn against the marked spans.

## When it runs

Always, with two narrow exceptions:

- **No rubric and fewer than two substantive blocks.** One mark and no rubric is too little signal to sweep against — quality proposals at that point are guesses, not second-reader value. Skip the sweep and omit its phase marker.
- **More than 15 user-mark substantive blocks on a single paper.** The reviewer is in heavy active control of that paper; additional unsolicited edits would be noise. Skip the sweep for that paper only (other papers in a multi-paper bundle still sweep normally).

The desktop's prelude reports `quality-sweep: skipped (no rubric and substantive blocks < 2)` when the first skip applies; trust the signal.

Otherwise, the sweep runs. If `paper.rubric.body` is present, frame the sweep against that rubric (audience, venue, tone). If no rubric is present, the default rubric is: *a top-venue paper — claims carry citations, terminology is consistent, prose is free of boilerplate and empty intensifiers, the argument is tight, and every section delivers on what the introduction promised.*

## How it runs

Piggyback on the single batched `paper-reviewer` Task call already issued in **Stress-test** — do **not** issue a second Task call. The budget cost of a holistic sweep is not worth a second cold-start and context reload. Extend the batched prompt with a `<obelus:quality-scan>` section that, after the per-edit critiques, asks the subagent to return up to 8 improvement proposals per paper the reviewer's marks did **not** already cover. Each proposal carries: `file:line-range`, an issue class (`clarity` / `boilerplate` / `citation-gap` / `weak-claim` / `rubric-drift` / `coverage-gap`), a `- before` / `+ after` diff no larger than 6 lines per side, and a one-sentence rationale. Instruct the subagent to skip any line range already covered by a user-mark, cascade, or impact block in this plan — the planner will also collision-guard, but surfacing the already-taken ranges up front saves the subagent's budget.

If the paper carries a `rubric`, quote it once in the quality-scan framing, fenced in `<obelus:rubric>` as everywhere else, and instruct the subagent to weigh each proposal against it.

## Eligibility and exclusions

A proposal is eligible for emission as a `quality-*` block when:

- its `file:line-range` resolves to a file in this paper's `sourceFiles`,
- the range does not collide with any line range already covered by a user-mark, cascade, or impact block in this run (collision guard — drop the proposal silently; do not try to merge patches),
- the proposed `+ after` side does not introduce a new claim without a citation placeholder (the `weak-claim` / `citation-gap` / `rubric-drift` proposals must insert the format-appropriate `TODO`-citation form from the **Edit shape** rules, exactly as a `citation-needed` user mark would), and
- the proposed edit compiles in the target format (same compile-awareness as user-mark edits — plain-text placeholders over uncertain macros).

Proposals that fail any of these drop out of the plan. Do not rewrite them; trust the subagent's next run.

## Block shape

- `annotationIds: ["quality-<fileShort>-<k>"]` — `<fileShort>` is the basename of the target file without extension (e.g. `01-introduction` for `paper/short/01-introduction.typ`); `<k>` is 1-based within that file.
- Non-empty `patch` — `quality-*` blocks are always real edits. Same single-hunk unified-diff shape as cascade blocks; the final-`\n` rule applies.
- `emptyReason: null`.
- `category` maps from the issue class: `clarity` → `unclear`, `boilerplate` → `unclear`, `citation-gap` → `citation-needed`, `weak-claim` → `weak-argument`, `rubric-drift` → `unclear`, `coverage-gap` → `unclear`.
- `ambiguous: false`.
- `reviewerNotes` starts with `"Quality pass: "` and names the issue in one sentence (e.g. `"Quality pass: hedging triad ('robust, scalable, and efficient') flattens the contribution; the surrounding paragraph already establishes the claim concretely."`). Keep it under 200 characters.
- `file` is the proposal's target file.

## Caps and ordering

At most 8 `quality-*` blocks per paper, at most 20 per run. The combined Impact + Quality cap is 40 per run. Note any cap that bites in the summary. `quality-*` blocks appear in the plan **after** all user-mark, cascade, and impact blocks for the same paper, grouped per paper, in the order the subagent returned them. The output writer's summary line counts them separately: `"Wrote 9 blocks (3 user, 2 cascade, 4 quality) — 0 ambiguous."`

## Phase marker

Emit `[obelus:phase] quality-sweep` on its own line at the top of this sweep. Bare line, no Markdown, no prose on the same line. Skip the marker (and the sweep) when one of the two skip conditions above applies.
