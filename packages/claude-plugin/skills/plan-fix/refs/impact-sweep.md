# Impact sweep

An edit that looks minimal at its own site can break the rest of the paper. Sometimes the breakage is lexical — the same term appears elsewhere unchanged. Sometimes it is structural — a renamed entity is referenced from other sections. Sometimes it is propositional — a claim the paper elsewhere depends on has just been narrowed, withdrawn, or reversed, and a whole section may stop making sense. This sweep catches each kind and acts proportionally: rewrite mechanically where it's safe, flag explicitly where it isn't. The sweep is not gated by `project.kind` (any `apply-revision` run wants coherent output) and not gated by annotation `category` (the delta classification below is the gate).

## Operative subset of the empty-patch invariants (for cascade/impact)

This file is self-sufficient for the impact-sweep work. **Do not re-`Read` `SKILL.md`** during this sweep — these are the rules you need:

| block prefix | `patch` | `emptyReason` | `ambiguous` |
|---|---|---|---|
| `cascade-*` | non-empty (proposed edit, single-hunk diff ending with `\n`) | `null` | `false` |
| `impact-*` | `""` | `"structural-note"` | `false` |

`cascade-*` blocks inherit `category` and `file` from the source block; `impact-*` blocks set `category: "unclear"` and `file` to the downstream site's file. Both carry a singleton `annotationIds` whose only element is the synthesised id. Both have substantive `reviewerNotes` — `cascade-*` starts with `"Cascaded from <sourceId>: "`, `impact-*` starts with `"Impact of <sourceId>: "` and names the downstream site, what is broken, and why no edit was suggested.

## Cascade-context Read rule — use in-context content

For every `±5 line` cascade-context lookup in Step 3 below, **the whole paper is already in your context** from the locating-spans whole-paper batch. Refer to the lines you already have; do **not** issue a fresh `Read` of a file that was in that batch. The previous run paid ~30s for one such redundant Read; the in-context content is identical and free.

If a `Grep` match lands in a file that was *not* in the original whole-paper batch (rare; only happens if the bundle's `project.files[]` excluded it), then a fresh `Read` is appropriate.

## Eligibility

Every source block that passed stress-test, carries a non-empty `patch`, and is not `ambiguous: true` enters the sweep. Cascade and impact blocks produced here never themselves seed further impact sweeps — one hop only, to avoid transitive explosions. `praise` blocks have no `patch` and no delta to analyse.

## Batched processing — non-negotiable

This sweep runs in three batched steps. **Do not iterate per source block** —
do not classify-then-Grep-then-decide for one block before moving to the next.
The per-block iterative pattern is the natural default and it is forbidden
here: with N source blocks it costs ~15 sec of judgment per cascade site and
scales linearly. The batched shape below scales sub-linearly because the
classification, the Grep, and the per-site decisions each fold into a single
reasoning pass.

If you find yourself thinking "for the first source block, I'll classify,
then Grep, then decide which hits cascade" — stop. That is the rejected shape.
Re-read this section and follow Step A → B → C exactly.

## Step A — classify every eligible source block in one pass

Build, internally, one classification table covering every eligible source
block (every block that passed stress-test, carries a non-empty `patch`, and
is not `ambiguous: true`). Do not emit the table as plan content; it is a
reasoning scratch.

For each row:

| field | value |
|---|---|
| `blockId` | the source block's annotation id (or merged-block id) |
| `deltaKind` | exactly one of `Lexical`, `Structural`, `Propositional`, `Local` |
| `userIntent` | one short clause from reading the source mark's `note` in plain language: "rename `X` to `Y` paper-wide" / "local phrasing tweak" / "claim narrowed from A to B" / "local clarification only" |
| `candidateTerms` | the search terms a downstream Grep should find. For Lexical: the substituted root plus its morphological variants (singular/plural, adjectival/nominal derivations, common compound phrases sharing the referent) — exclude stopwords, single-letter tokens, and surface-form changes. For Structural: the renamed entity's machine-readable handle (`\ref` / `@label`) AND its human-readable name string. For Propositional: phrases, numbers, or named entities from the `- before` side that downstream prose may cite. For Local: empty array. |
| `candidateScopes` | array of file paths the Grep should cover. By default this is the source block's own `file` (the sweep never crosses papers). Include other files in the same `paper.id` only when the entity is paper-wide (a `\label` referenced from sibling chapter files). Never include bibliography / asset / cross-paper files. |
| `rationale` | one short sentence that will seed `reviewerNotes` for any block emitted from this row, e.g. "Same referent as line 142 'settings → contexts'". |

Classification rules (carried forward from the prior procedure):

- **Lexical.** A content-bearing token or short token-sequence (1–4 tokens)
  is substituted: a term rename, a symbol change (`k=8` → `k=7`), a numerical
  correction (`4.2B` → `4.1B`), a method or dataset rename. Exclude stopwords
  (`the`, `a`, `of`, `in`, `where`, `such`, …), common verbs (`is`, `are`,
  `has`, `uses`), single-letter tokens, pure punctuation/whitespace diffs,
  reorderings that drop no token, and surface-form changes (hyphenation,
  pluralisation of the same root). Pure additions (e.g. a `\cite{TODO}`
  placeholder tacked onto unchanged before-text) are **not** Lexical.
- **Structural.** An entity referenced from elsewhere is renamed,
  relabelled, or removed — a `\label{…}` / `\ref{…}` target, theorem number,
  section heading, dataset/algorithm name, figure caption key phrase.
- **Propositional.** The underlying claim changes: narrowed, withdrawn,
  reversed, qualified, or a reported numerical result changes in a way other
  sections may cite. The dangerous class — surface matching alone misses it.
- **Local.** Sentence rewording, register shift, hedging, clarification
  with no entity rename and no claim change. `candidateTerms = []`.

If torn between **Propositional** and **Local**, mark **Propositional** —
the cost of an extra flag is cheap; a silently unsupported section is not.

When the user-intended root differs from the surface token in the diff
(worked case: diff shows `failure modes → patterns` but the note describes
a rename of `failure` to `pattern`), record the user-intended root in
`candidateTerms`, not the phrase lifted from the diff.

## Step B — one unified Grep across the union

Once Step A's table is complete, issue **one** `Grep` call:

- `pattern`: the alternation of every non-empty `candidateTerms` value across
  every row, joined with `|`. Use whole-word boundaries when the underlying
  Grep supports them (`\bterm1\b|\bterm2\b|…`); if the alternation contains
  a regex metacharacter, escape it. Case-insensitive.
- `output_mode`: `content` with `-n` and `-C 5` (line numbers + 5 lines of
  context above and below) so each hit arrives with enough surrounding
  prose to judge same-referent without a follow-up Read.
- `path` / `glob`: the union of every row's `candidateScopes`. Default to
  the source block's `file` when scopes were omitted.

If every row's `candidateTerms` is empty (only Local deltas), skip Step B
and Step C — emit zero blocks. The phase marker still fired; that is the
correct outcome.

If the alternation produces a pattern longer than ~500 characters, split
into at most two Grep calls grouped by file scope; do not split per term.
Two calls is the hard ceiling — a third call indicates Step A is
mis-classifying and over-generating candidate terms.

Do not issue a fresh `Read` for cascade context. The whole-paper batch from
locating-spans is already in your context; refer to those lines around each
Grep hit. The only legal `Read` in this phase is for a file that was *not*
in the original whole-paper batch (rare; only when `project.files[]`
excluded it).

## Step C — invoke cascade-judge once over every hit

After Step B's Grep returns, invoke the `cascade-judge` subagent **once**
via `Task` with `subagent_type: "cascade-judge"`. Do NOT walk the hit list
yourself; do NOT issue any further `Read` or `Grep` during this step.

Payload — fence everything inside one `<obelus:hits>…</obelus:hits>` block,
exactly:

    <obelus:hits>
    {
      "sourceBlocks": [
        {
          "blockId": "<...>",
          "deltaKind": "Lexical|Structural|Propositional|Local",
          "userIntent": "<one short clause>",
          "candidateTerms": ["...","..."],
          "rationale": "<one sentence>"
        },
        ...
      ],
      "hits": [
        {
          "file": "<rel path>",
          "lineStart": <int>,
          "lineEnd": <int>,
          "matchedSubstring": "<as Grep returned>",
          "contextLines": [
            "<L-5>", "<L-4>", "<L-3>", "<L-2>", "<L-1>",
            "<MATCHED LINE>",
            "<L+1>", "<L+2>", "<L+3>", "<L+4>", "<L+5>"
          ]
        },
        ...
      ]
    }
    </obelus:hits>

The subagent returns a single JSON block keyed `decisions`. Parse it once.
Convert the array into blocks per the shapes below: every `cascade` row
becomes a `cascade-<sourceIdShort>-<k>` block; every `impact` row becomes
an `impact-<sourceIdShort>-<k>` block; `skip` rows produce nothing. The
collision guard, the cap accounting, and the block-shape composition
all run here in the planner — `cascade-judge` only judges.

If the subagent's JSON fails to parse (malformed, missing the `decisions`
key, or includes prose around the code block), fall back to the
in-process per-hit pattern: walk the hits in order, applying the same
decision rules listed in `cascade-judge.md` (mapping, format-fence,
homonym, cascade-vs-flag) to each, emitting blocks as you go. Note the
fallback in the run summary so the user knows.

Caps applied during block emission (after parsing the subagent's
decisions), not by the subagent:
- ≤ 10 `cascade` per `ownerSourceId`.
- ≤ 5 `impact` per `ownerSourceId`.
- ≤ 40 `cascade + impact` per run.

When a source block's cascade cap is hit, skip subsequent decisions owned
by that block and note the binding cap in the run summary.

## Block shapes

- `cascade-<sourceIdShort>-<k>` — `annotationIds: ["cascade-<sourceIdShort>-<k>"]`, non-empty `patch`, `category` inherited from the source block, `file` inherited from the source block, `ambiguous: false`, `emptyReason: null`, `reviewerNotes` starts with `"Cascaded from <sourceId>: "` and names the referent check in one line (e.g. `"Same referent as line 142 'settings → contexts'; surrounding sentence refers to deployment contexts, not configuration."`). Patch is a single-hunk unified diff with the final-`\n` rule preserved.
- `impact-<sourceIdShort>-<k>` — **Pre-condition (per Cascade vs. flag):** the downstream site is a proof, derivation, figure/table, or algorithm/model definition. If it is plain prose, the correct block is `cascade-*` — re-emit accordingly, do not write an `impact-*`. `annotationIds: ["impact-<sourceIdShort>-<k>"]`, `patch: ""`, `category: "unclear"` (so the diff-review UI surfaces it as an author-facing note without presenting a patch to accept/reject), `file` is the downstream site's file, `ambiguous: false`, `emptyReason: "structural-note"`. `reviewerNotes` starts with `"Impact of <sourceId>: "` and must name in one sentence (a) **the downstream site** (file + line range), (b) **what is broken** by the source edit, and (c) **why no edit was suggested** (what kind of rework is needed). Example: `"Impact of <sourceId>: Section 3.2 (lines 204–218) repeats the i.i.d. assumption just withdrawn; the Corollary 1 proof relies on it and would need a structural rewrite no single-hunk patch restores."` An `impact-*` block whose `reviewerNotes` is empty, omits any of the three sub-clauses, or carries only the `"Impact of <sourceId>: "` prefix is a defect — the desktop validator rejects it and the user sees a content-less informational mark.

`<sourceIdShort>` is the first 8 characters of the originating annotation's id (strip dashes if UUID-shaped). `<k>` is 1-based within that source, counted separately for the `cascade-` and `impact-` prefixes.

## Caps and ordering

At most 10 `cascade-*` blocks per source edit (the cap covers all cascade emissions — lexical, structural, and propositional combined), at most 5 `impact-*` blocks per source edit, at most 40 cascade + impact blocks combined per run. Propositional cascades typically resolve into 1–3 dependent sites, well under the cap; on the rare paper that hits the cap, prioritise the highest-impact sites and note the binding cap in the summary. Cascade and impact blocks produced for a given source edit appear in the plan **immediately after their source block**, cascade blocks first (by match order within the file), then impact blocks (by file, then line). The downstream coherence sweep and the output writer both iterate in that order.

## Phase marker

Emit `[obelus:phase] impact-sweep` on its own line at the top of this section, before any `Grep` / `Read` you do for the sweep. Bare line, no Markdown, no prose on the same line, no trailing punctuation. Skip the marker if no eligible blocks entered the sweep (every block is `praise`, `ambiguous`, or has empty `patch`).
