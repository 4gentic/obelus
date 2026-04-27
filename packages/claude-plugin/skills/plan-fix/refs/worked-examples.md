# Worked examples

Three end-to-end examples covering LaTeX, Typst, and the holistic-merge case (one block satisfying multiple marks). The block envelope shape comes from the main SKILL.md's **Output — JSON** section.

The desktop projects a sibling `plan-<iso>.md` from the JSON these examples emit; this skill never writes Markdown itself.

## Worked example — LaTeX

One annotation, end to end. Input (a single mark in the bundle):

```
id: 550e8400-e29b-41d4-a716-446655440001
category: citation-needed
quote: "as shown by Vaswani et al."
note: "needs full citation"
anchor: { file: "main.tex", lineStart: 142, lineEnd: 142 }   # pre-resolved by the desktop
```

The matching `<workspace>/plan-20260423-143012.json` (top-level envelope plus the one block):

```json
{
  "bundleId": "/abs/path/to/obelus-review-20260423.json",
  "format": "latex",
  "entrypoint": "main.tex",
  "blocks": [
    {
      "annotationIds": ["550e8400-e29b-41d4-a716-446655440001"],
      "file": "main.tex",
      "category": "citation-needed",
      "patch": "@@ -142,1 +142,1 @@\n- as shown by Vaswani et al.\n+ as shown by Vaswani et al.~\\cite{TODO}\n",
      "ambiguous": false,
      "reviewerNotes": "The edit addresses the note by inserting a placeholder rather than guessing a key, and it does not introduce a new claim.",
      "emptyReason": null
    }
  ]
}
```

`apply-fix` reads either this `.json` directly or the desktop-projected sibling `.md`; the desktop diff-review UI consumes the `.json`.

## Worked example — Typst

Same shape, different format. Input:

```
id: 550e8400-e29b-41d4-a716-446655440042
category: citation-needed
quote: "as shown by Vaswani et al."
note: "needs full citation"
anchor: { file: "main.typ", lineStart: 42, lineEnd: 42 }
```

JSON (top-level envelope plus the one block) — note `format: "typst"` and `entrypoint: "main.typ"`, which `apply-fix` reads to decide whether to run post-apply compile verification:

```json
{
  "bundleId": "/abs/path/to/obelus-review-20260423.json",
  "format": "typst",
  "entrypoint": "main.typ",
  "blocks": [
    {
      "annotationIds": ["550e8400-e29b-41d4-a716-446655440042"],
      "file": "main.typ",
      "category": "citation-needed",
      "patch": "@@ -42,1 +42,1 @@\n- as shown by Vaswani et al.\n+ as shown by Vaswani et al. #emph[(citation needed)]\n",
      "ambiguous": false,
      "reviewerNotes": "The edit addresses the note by inserting a placeholder that keeps the file compilable, and it does not introduce a new claim.",
      "emptyReason": null
    }
  ]
}
```

`@TODO` and `#cite(<TODO>)` would both fail to compile without a matching bibliography entry; `#emph[(citation needed)]` renders as italic plain text and is grep-able for the author's later pass.

## Worked example — holistic merge

The reviewer marked an abstract three times: two specific phrasings inside it (one `unclear`, one `rephrase`) and one `enhancement` on the whole abstract whose note says "too long, tighten — keep contribution + result, drop related-work paragraph". The planner emits **one** block whose `annotationIds` lists all three marks; the rewrite tightens the abstract while honouring both phrasing concerns.

JSON block:

```json
{
  "annotationIds": [
    "770e8400-e29b-41d4-a716-446655440003",
    "550e8400-e29b-41d4-a716-446655440001",
    "660e8400-e29b-41d4-a716-446655440002"
  ],
  "file": "paper.tex",
  "category": "enhancement",
  "patch": "@@ -10,5 +10,4 @@\n- Abstract\n-\n- We propose a new method. ...\n+ Abstract\n+\n+ We present a contrastive training objective that ...\n",
  "ambiguous": false,
  "reviewerNotes": "paper-reviewer critique here.",
  "emptyReason": null
}
```

The merged block's `reviewerNotes` should describe how the diff satisfies each contributing mark when the planner has merged them.
