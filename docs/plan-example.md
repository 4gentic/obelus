# A worked plan, end to end

This document shows the artefact the plugin produces when you run `/apply-revision` on a
bundle: the **plan JSON**. It is the contract the desktop diff-review UI reads, and the only
file the planner writes. Reading it here means you can see the shape without installing the
desktop or running an engine.

The flow is: you review a paper in the app and export a bundle; in your paper repo you run
`/apply-revision <bundle>`; the plugin validates the bundle, locates each mark in your source,
and writes `$OBELUS_WORKSPACE_DIR/plan-<timestamp>.json`. The desktop projects a sibling
`plan-<timestamp>.md` from that JSON for you to read — but the JSON is authoritative. Nothing
touches your source tree until you run `/apply-fix` on the plan.

The canonical schema is `PlanFile` in [`@obelus/claude-sidecar`](../packages/claude-sidecar/src/plan.ts);
the planner that emits it is [`plan-fix`](../packages/claude-plugin/skills/plan-fix/SKILL.md).
The example below is grounded in the committed sample bundle
([`packages/claude-plugin/fixtures/sample/bundle.json`](../packages/claude-plugin/fixtures/sample/bundle.json),
three marks on a short paper about transformer-attention scalability).

## The shape

A plan is one envelope around an array of blocks. Every key shown is required; the desktop
rejects a plan that adds, renames, or drops any of them.

```jsonc
{
  "bundleId": "<absolute path to the bundle file, or its sha256>",
  "format": "typst | latex | markdown | html | \"\"",
  "entrypoint": "<main source path, relative to repo root, or \"\">",
  "blocks": [
    {
      "annotationIds": ["<mark id>", "..."], // one id, or several when one edit answers several marks
      "file": "<resolved source file, or \"\" if unresolved>",
      "category": "<the mark's category slug>",
      "patch": "<a single-hunk unified diff, or \"\">",
      "ambiguous": false,
      "reviewerNotes": "<the paper-reviewer critique, verbatim>",
      "emptyReason": null
    }
  ]
}
```

One block describes one **edit**, not one mark. When two marks land on the same passage, the
planner merges them into a single block whose `annotationIds` lists both. When a mark warrants
no edit — praise, an aside, a span it could not locate — the block carries an empty `patch`
and an `emptyReason` saying why.

## A full example

This is the plan for the sample bundle's three marks, plus one block the planner synthesised on
its own. Paths are placeholders: `<workspace>` stands for the absolute `$OBELUS_WORKSPACE_DIR`
the desktop hands the engine.

```json
{
  "bundleId": "<workspace>/bundle-20260427-143404.json",
  "format": "latex",
  "entrypoint": "main.tex",
  "blocks": [
    {
      "annotationIds": ["11111111-1111-4111-8111-111111111111"],
      "file": "main.tex",
      "category": "elaborate",
      "patch": "@@ -18 +18 @@\n-The dot-product attention operator of Vaswani et al.\\ takes $O(n^2 d)$ time for a sequence of length $n$ and head dimension $d$.\n+The dot-product attention operator of Vaswani et al.~\\cite{TODO} takes $O(n^2 d)$ time for a sequence of length $n$ and head dimension $d$.\n",
      "ambiguous": false,
      "reviewerNotes": "The bare name needs a citation; a TODO placeholder is the right call rather than inventing a key. Confirm the reference resolves before compiling.",
      "emptyReason": null
    },
    {
      "annotationIds": ["22222222-2222-4222-8222-222222222222"],
      "file": "main.tex",
      "category": "wrong",
      "patch": "@@ -20 +20 @@\n-Recent work claims that linear-time attention variants close this gap with negligible loss of quality.\n+Recent work reports that some linear-time attention variants narrow this gap, though with quality costs that vary by task.\n",
      "ambiguous": false,
      "reviewerNotes": "The softening is faithful to the abstract's own hedge that gains are task-dependent; it does not overcorrect into the opposite claim.",
      "emptyReason": null
    },
    {
      "annotationIds": ["33333333-3333-4333-8333-333333333333"],
      "file": "main.tex",
      "category": "praise",
      "patch": "",
      "ambiguous": false,
      "reviewerNotes": "",
      "emptyReason": "praise"
    },
    {
      "annotationIds": ["cascade-22222222-1"],
      "file": "main.tex",
      "category": "wrong",
      "patch": "@@ -32 +32 @@\n-These results suggest that the community's reported wins for linear attention are driven by benchmarks that do not stress long-range retrieval.\n+These results suggest that the community's reported wins for linear attention are driven largely by benchmarks that do not stress long-range retrieval.\n",
      "ambiguous": false,
      "reviewerNotes": "Cascaded from 22222222-2222-4222-8222-222222222222: the Discussion restates the softened claim, so the same hedge belongs here for the paper to stay consistent.",
      "emptyReason": null
    }
  ]
}
```

## Reading it

- **`format` and `entrypoint`** echo what the plugin detected in your repo. `apply-fix` uses
  the entrypoint to compile-check after applying. Either may be `""` when no source was found
  or the run spanned several papers.
- **The first block** is a real edit. The mark was `elaborate` ("needs a full citation"), so the
  patch inserts a `\cite{TODO}` placeholder — the planner never invents a reference. `emptyReason`
  is `null` because the patch is non-empty, and `ambiguous` is `false` because the span was located.
- **The second block** softens an overclaim. `wrong` marks propose a correction; `rephrase` would
  reshape without changing the claim. The category is the mark's, carried through verbatim.
- **The third block** is praise. No edit is warranted, so `patch` is `""` and `emptyReason` is
  `"praise"`. The desktop renders it as a status badge in the margin, never as a diff row.
- **The fourth block** is *synthesised* — its id is `cascade-…`, not one of your mark ids. The
  planner's impact sweep noticed the Discussion section restates the claim the second block
  softened, and proposed the same hedge there so the paper stays internally consistent. You
  accept or reject it on its own, like any other block.

## The empty-patch rule

Every block is either a real edit or a no-edit note — never both, and never neither. The legal
combinations of `(patch, emptyReason, ambiguous)`:

| `patch`   | `emptyReason`         | `ambiguous` | When                                                            |
|-----------|-----------------------|-------------|----------------------------------------------------------------|
| non-empty | `null`                | `false`     | a normal edit; also `cascade-*` and `directive-*`              |
| `""`      | `"praise"`            | `false`     | a praise mark, no edit warranted                               |
| `""`      | `"no-edit-requested"` | `false`     | a note whose body did not ask for a change                     |
| `""`      | `"ambiguous"`         | `true`      | the span could not be located; `reviewerNotes` says why        |
| `""`      | `"structural-note"`   | `false`     | a synthesised `impact-*` or `coherence-*` flag-note            |

An `ambiguous: true` block is the planner being honest: it found a mark it could not place with
confidence, and refuses to guess. `apply-fix` skips it and surfaces it in the summary, so a mark
is never silently dropped.

## Synthesised blocks

User marks come first, in bundle order. After them the planner may add blocks it reasoned into
existence — keyed by a prefix on the first `annotationId`:

- **`cascade-*`** — the same lexical or structural change proposed at another occurrence (a real
  patch). `reviewerNotes` starts with `Cascaded from <id>: `.
- **`impact-*`** — a downstream site the edit may have undermined, flagged for you to reconsider
  (empty patch). `reviewerNotes` starts with `Impact of <id>: `.
- **`coherence-*`** — two of your edits drifting apart in terminology (empty patch).
- **`directive-*`** — an edit answering a free-text instruction you gave for the whole pass
  rather than a single mark (a real patch). `reviewerNotes` starts with `Directive: `.

Each is independent in the diff-review UI: accept, reject, or ignore one without touching the
rest.

## Patch format

`patch` is a single-hunk unified diff: a `@@ -L,N +L,N @@` header, then context, `-` (before),
and `+` (after) lines. **Every line, including the last, ends with `\n`** — that is the format,
and a patch whose final line lacks it is malformed. The desktop recomputes the `@@` line counts
on apply and anchors on the exact deleted text, so the `- before` lines must be copied verbatim
and in full from your source. Empty string only when `emptyReason` is non-null.
