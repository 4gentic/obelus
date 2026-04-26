# Worked examples

Three end-to-end examples covering LaTeX, Typst, and the holistic-merge case (one block satisfying multiple marks). The block templates and JSON envelope shape come from the main SKILL.md's **Output — markdown** and **Output — JSON** sections.

## Worked example — LaTeX

One annotation, end to end. Input (a single mark in the bundle):

```
id: 550e8400-e29b-41d4-a716-446655440001
category: citation-needed
quote: "as shown by Vaswani et al."
note: "needs full citation"
anchor: { file: "main.tex", lineStart: 142, lineEnd: 142 }   # pre-resolved by the desktop
```

The corresponding block in `<workspace>/plan-20260423-143012.md`:

```md
## 1. citation-needed — 550e8400-e29b-41d4-a716-446655440001

**Where**: `main.tex:142-142`
**Quote**: "as shown by Vaswani et al."
**Note**: needs full citation

**Change**:
```diff
- as shown by Vaswani et al.
+ as shown by Vaswani et al.~\cite{TODO}
```

**Why**: insert a TODO citation placeholder per the `citation-needed` rule; the planner does not invent the reference.

**Reviewer notes**: The edit addresses the note by inserting a placeholder rather than guessing a key, and it does not introduce a new claim.

**Ambiguous**: false
**Empty reason**: none
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

The two artefacts contain the same blocks in the same order. The `.md` is what `apply-fix` reads; the `.json` is what the desktop diff-review UI consumes.

## Worked example — Typst

Same shape, different format. Input:

```
id: 550e8400-e29b-41d4-a716-446655440042
category: citation-needed
quote: "as shown by Vaswani et al."
note: "needs full citation"
anchor: { file: "main.typ", lineStart: 42, lineEnd: 42 }
```

Block in `<workspace>/plan-20260423-143012.md`:

```md
## 1. citation-needed — 550e8400-e29b-41d4-a716-446655440042

**Where**: `main.typ:42-42`
**Quote**: "as shown by Vaswani et al."
**Note**: needs full citation

**Change**:
```diff
- as shown by Vaswani et al.
+ as shown by Vaswani et al. #emph[(citation needed)]
```

**Why**: insert a compilable Typst placeholder per the `citation-needed` rule. `@TODO` and `#cite(<TODO>)` would both fail to compile without a matching bibliography entry; `#emph[(citation needed)]` renders as italic plain text and is grep-able for the author's later pass.

**Reviewer notes**: The edit addresses the note by inserting a placeholder that keeps the file compilable, and it does not introduce a new claim.

**Ambiguous**: false
**Empty reason**: none
```

Matching JSON (top-level envelope plus the one block) — note `format: "typst"` and `entrypoint: "main.typ"`, which `apply-fix` reads to decide whether to run post-apply compile verification:

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

## Worked example — holistic merge

The reviewer marked an abstract three times: two specific phrasings inside it (one `unclear`, one `rephrase`) and one `enhancement` on the whole abstract whose note says "too long, tighten — keep contribution + result, drop related-work paragraph". The planner emits **one** block whose `annotationIds` lists all three marks; the rewrite tightens the abstract while honouring both phrasing concerns.

```md
## 1. enhancement — 770e8400-e29b-41d4-a716-446655440003

**Where**: `paper.tex:10-24`
**Quote**: "Abstract — We propose a new method..."
**Note**: too long, tighten — keep contribution + result, drop related-work paragraph
**Affects**: 770e8400-e29b-41d4-a716-446655440003, 550e8400-e29b-41d4-a716-446655440001, 660e8400-e29b-41d4-a716-446655440002

**Change**:
```diff
- Abstract
-
- We propose a new method. Prior work has explored ... [related-work paragraph]. We present
- a contrastive training objective, achieving state-of-the-art results on three benchmarks.
+ Abstract
+
+ We present a contrastive training objective that closes the Liu et al. (2024) gap and
+ improves three benchmark scores by 4-7%.
```

**Why**: replaces the vague claim with the specific contribution (mark ...440001), drops the hyped phrasing (mark ...440002), and tightens the abstract by dropping the related-work paragraph (mark ...440003).

**Reviewer notes**: paper-reviewer critique here.

**Ambiguous**: false
**Empty reason**: none
```

Matching JSON block:

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
