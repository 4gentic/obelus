# Coherence sweep

Edit-vs-edit drift detection across the plan. The sweep iterates over
source edits **plus any cascade blocks** emitted by the Impact sweep.
`impact-*` flag-notes carry `patch: ""` and are out of scope; skip them.

Always runs in rigorous mode — never gated on substantive-mark count.
A cascade applying the *same* token swap as its source is the expected
outcome, not drift. A coherence note IS warranted when two *different*
source edits cascade to different strings for the same original token
(e.g. one rename "settings" → "contexts" and another "settings" →
"scenarios"). When the sweep finds nothing, it emits zero blocks; the
phase marker still fires; that is the correct outcome and is distinct
from "the sweep never ran".

## No file reads inside this phase — non-negotiable

Forbidden in this phase: `Read`, `Glob`, `Grep`. The whole-paper context
from locating-spans is already in your context; the proposed diffs and
their reviewer notes are in your context; that is the entire evidence
base for this sweep. Drift you cannot see from the diffs alone is out of
scope by design.

A natural-feeling thought like *"let me Grep for `theorem` to confirm the
notation matches the paper's existing usage"* is exactly the failure mode
this rule rejects. The sweep is **edit-vs-edit**: if two edits in this
plan agree on a notation, that is what we record; how the rest of the
paper uses that notation is the Impact sweep's concern, already executed.

## One batched emission pass

Walk the plan blocks once, grouped by paper, producing all `coherence-*`
blocks in a single output. Do not iterate "for each pair, decide" — that
is the per-item shape this sweep explicitly rejects. Instead: across all
edits in the paper, identify every instance of each of the four drift
categories at once, then emit one block per drift instance.

The four categories:

- **Terminology drift** — two edits use different names for the same
  concept (e.g. one says "the proposed estimator", another "the new
  algorithm" for the same thing).
- **Notation mismatch** — one edit introduces a symbol another edit
  already used with a different meaning, or two edits disagree on
  subscripts / function signatures.
- **Duplicate definitions** — two edits each insert a definition of the
  same term.
- **Tone drift** — a stretch of edits that individually pass but
  collectively shift register (hedged → assertive, passive → active,
  informal → formal) in a way the paper elsewhere does not sanction.

For each drift instance, emit one block:

- `annotationIds: ["coherence-<k>"]` where `k` is 1-based per run.
- `category: "unclear"` (so the diff-review UI surfaces it as an
  author-facing flag without a patch to accept/reject).
- `patch: ""`
- `emptyReason: "structural-note"`
- `ambiguous: false`
- `reviewerNotes`: one sentence naming the two (or more) annotation ids
  involved and the drift you saw. Non-empty (the desktop validator
  rejects empty `reviewerNotes` on `coherence-*` blocks). Under 140
  characters.

If the sweep finds nothing, emit no extra blocks. Do not pad — a vague
"edits are consistent" block is a defect, not a finding.

## Phase marker

Emit `[obelus:phase] coherence-sweep` on its own line at the top of this
sweep. Bare line, no Markdown, no prose on the same line. Skip the
marker (and the sweep) when the prelude says `coherence-sweep: skipped`.
