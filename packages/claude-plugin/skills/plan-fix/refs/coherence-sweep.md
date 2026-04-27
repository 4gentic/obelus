# Coherence sweep

The sweep always runs in rigorous mode — it is never gated on a substantive-mark count. Even with a single edit there can be edit-vs-source drift worth flagging (a notation introduced by the edit that disagrees with notation already in the paper). When the sweep finds nothing to flag, it emits zero blocks; that is the correct outcome and is distinct from "the sweep never ran". The phase marker still fires.

The sweep iterates over source edits **plus any cascade blocks** emitted by the Impact sweep. `impact-*` flag-notes carry `patch: ""` and are out of scope for edit-vs-edit drift; skip them. The sweep's rubric is *edit-vs-edit*: terminology drift, notation mismatch, duplicate definitions, tone drift. Look only at the proposed diffs and a ±5-line context around each. Do not re-`Read` full source files for the sweep — drift you are checking for lives inside the edits. A cascade block applying the *same* token swap as its source is the expected outcome, not drift, and must not trigger a `coherence-<k>` note on that basis alone. A coherence note IS warranted when two *different* source edits cascade to different strings for the same original token (e.g. one source renames "settings" → "contexts" and another renames "settings" → "scenarios").

After every substantive block has its own diff and reviewer note, do one final pass across the whole plan, grouped by paper. Check:

- **Terminology drift**: two edits use different names for the same concept (e.g. one says "the proposed estimator", another says "the new algorithm" for the same thing).
- **Notation mismatch**: one edit introduces a symbol that another edit already used with a different meaning, or two edits disagree on subscripts / function signatures.
- **Duplicate definitions**: two edits each insert a definition of the same term.
- **Tone drift**: a stretch of edits that individually pass but collectively shift register (hedged → assertive, passive → active, informal → formal) in a way the paper elsewhere does not sanction.

For each rough spot you find, emit an *additional* block with:

- `annotationIds: ["coherence-<k>"]` where `k` is 1-based per run
- `category: "unclear"` (so it surfaces in the diff-review UI as an author-facing flag without presenting a patch to accept/reject)
- `patch: ""` (no edit — this is a note, not a change)
- `emptyReason: "structural-note"`
- `ambiguous: false`
- `reviewerNotes`: one sentence naming the two (or more) annotation ids involved and the drift you saw. Non-empty (the desktop validator rejects empty `reviewerNotes` on `coherence-*` blocks). Keep it under 140 characters.

If the sweep finds nothing, emit no extra blocks. Do not pad.

**Example of a non-padding sweep.** Three annotations: `(unclear)` rephrasing the abstract, `(citation-needed)` on a Vaswani reference, `(praise)` on the conclusion. Each fix sits in its own paragraph, uses unrelated terminology, introduces no new symbols, and the register matches the surrounding text. The sweep emits **zero** `coherence-*` blocks. The summary's `coherence: 0` line is the correct outcome — do not invent a vague "edits are consistent" block to fill the section.

## Phase marker

Emit `[obelus:phase] coherence-sweep` on its own line at the top of this sweep. Bare line, no Markdown, no prose on the same line. Skip the marker (and the sweep) when the prelude's skip-condition signal says `coherence-sweep: skipped`.
