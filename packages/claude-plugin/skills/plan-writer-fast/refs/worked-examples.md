# Worked example — plan-writer-fast

One end-to-end example showing the holistic-merge case (one block satisfying multiple marks). The block template and JSON envelope shape come from the main SKILL.md's **Step 4** and **Step 5** sections.

## Worked example — one merged block satisfying three marks

The reviewer marked an abstract three times: two specific phrasings inside it (one `unclear`, one `rephrase`) and one `enhancement` on the whole abstract whose note says "too long, tighten — keep the contribution and the result, drop the related-work paragraph".

Input bundle (relevant fields only):

```json
{
  "project": { "id": "...", "kind": "writer", "main": "paper.tex" },
  "papers": [{ "id": "p1", "title": "Draft" }],
  "annotations": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "paperId": "p1", "category": "unclear",
      "quote": "We propose a new method.",
      "note": "vague — what's actually new?",
      "anchor": { "kind": "source", "file": "paper.tex", "lineStart": 12, "lineEnd": 12, "colStart": 0, "colEnd": 23 }
    },
    {
      "id": "660e8400-e29b-41d4-a716-446655440002",
      "paperId": "p1", "category": "rephrase",
      "quote": "achieving state-of-the-art results",
      "note": "less hype",
      "anchor": { "kind": "source", "file": "paper.tex", "lineStart": 18, "lineEnd": 18, "colStart": 4, "colEnd": 35 }
    },
    {
      "id": "770e8400-e29b-41d4-a716-446655440003",
      "paperId": "p1", "category": "enhancement",
      "quote": "Abstract\n\nWe propose ...",
      "note": "too long, tighten — keep contribution + result, drop related-work paragraph",
      "anchor": { "kind": "source", "file": "paper.tex", "lineStart": 10, "lineEnd": 24, "colStart": 0, "colEnd": 0 }
    }
  ]
}
```

Block in `$OBELUS_WORKSPACE_DIR/plan-20260423-143012.md`:

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

**Reviewer notes**:

**Ambiguous**: false
**Empty reason**: none
```

Matching JSON block (the diff string is shown wrapped for readability; emit it as a single JSON string):

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
  "reviewerNotes": "",
  "emptyReason": null
}
```
