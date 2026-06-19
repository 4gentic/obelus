// PRE-BAKED — not generated from a live engine run.
//
// This fixture is the "see the result" payoff for the bundled sample paper
// ("Daedalus & Icarus", a critical edition of Ovid, Metamorphoses VIII). It
// shows what an AI engine (Claude Code / OpenCode) would hand back for the
// sample marks — a plan plus the diff those marks imply against the edition's
// LaTeX source — without anything leaving the device and without an engine
// ever running.
//
// Every entry is derived from a real mark in `sample-annotations.generated.ts`,
// keyed by quote. The plan shape mirrors the plugin's contract: each card is a
// PlanBlock as defined by `PlanFile`/`PlanBlock` in `@obelus/claude-sidecar`
// (annotationIds, file, category, patch, ambiguous, reviewerNotes,
// emptyReason). `praise` marks carry an empty patch with
// `emptyReason: "praise"`, exactly as the planner emits them; the three
// actionable marks (two editorial `note`s and one `rephrase`) carry a real
// minimal-diff edit. Nothing here is invented — the changes are defensible
// editorial edits a copy-editor of this edition would make.

import type { DiffFile } from "@obelus/diff-view";

export const SAMPLE_RESULT_LABEL = "Pre-baked example — no engine ran";

export const SAMPLE_RESULT_ENTRYPOINT = "daedalus-icarus.tex";

// Mirror of the plugin's PlanBlock contract, narrowed to the fields a
// read-only viewer needs. `quote` and `whatChanges` are projections the
// desktop computes when it renders a plan card; we precompute them here so the
// demo can show "which mark, what changes, and why" without the live row data.
export interface SampleResultBlock {
  // The mark this card answers, by category + the marked text. A real plan
  // carries opaque annotation ids; for a pre-baked demo the quote is the
  // honest, human-readable stand-in.
  category: string;
  quote: string;
  // One line naming the edit, or null for an empty-patch (praise / note-only)
  // block where there is nothing to apply.
  whatChanges: string | null;
  // The planner's `reviewerNotes` — the *why*. For empty-patch blocks this is
  // the reason the mark needs no source edit.
  why: string;
  // The plugin's `emptyReason`, present iff the block carries no patch.
  emptyReason: "praise" | null;
}

export const SAMPLE_RESULT_PLAN: ReadonlyArray<SampleResultBlock> = [
  {
    category: "note",
    quote: "creverat obprobrium generis",
    whatChanges:
      "Record obprobrium as a deliberate spelling in the apparatus, not silently normalise it.",
    why: "The mark asks whether the unassimilated obprobrium is an archaism or a typo. An editor never resolves that by quietly changing the text — the right edit is an apparatus note that records the reading and its modern form, leaving the lemma standing. So this adds a critical-apparatus line for v. 187 and keeps the verse untouched.",
    emptyReason: null,
  },
  {
    category: "note",
    quote: "Daedalus ingenio fabrae celeberrimus artis",
    whatChanges: "Add a commentary gloss on ingenio (wit) standing where ars (skill) is expected.",
    why: "The mark observes that Ovid introduces Daedalus through ingenium rather than ars, foreshadowing the failure mode. That is a reading worth preserving for the next editor, not a defect — so this adds a one-line commentary note keyed to the verse and changes nothing in the text itself.",
    emptyReason: null,
  },
  {
    category: "rephrase",
    quote: "ducit in errorem variarum ambage viarum",
    whatChanges:
      'Facing translation: "winding maze of meandering ways" → "maze of circuitous deceits".',
    why: 'The mark notes that ambages carries the legal sense of circumlocution before it ever means a winding path, and that "meandering ways" loses that subtext. The Latin is sound; only the facing English is reshaped — "circuitous deceits" keeps the legal undertone the mark asked to preserve.',
    emptyReason: null,
  },
  {
    category: "praise",
    quote: "tum lino medias et ceris alligat imas",
    whatChanges: null,
    why: "Praise, not a change request. The mark calls out how the word order (lino medias / ceris imas) mirrors the layered construction of the wings. Nothing to apply — carried so it can seed the cover letter's account of the edition's strengths.",
    emptyReason: "praise",
  },
  {
    category: "praise",
    quote: "stabat et, ignarus sua se tractare pericla",
    whatChanges: null,
    why: "Praise, not a change request. The mark admires how the participial phrase compresses the whole tragedy into five words. No source edit — held for the cover letter.",
    emptyReason: "praise",
  },
  {
    category: "praise",
    quote: "ipse suum corpus motaque pependit in aura",
    whatChanges: null,
    why: "Praise, not a change request. The mark notes that Ovid does not skip Daedalus testing the wings on his own body — the ethical weight of the episode hangs from this line. Nothing to apply.",
    emptyReason: "praise",
  },
  {
    category: "praise",
    quote: "et tellus a nomine dicta sepulti",
    whatChanges: null,
    why: "Praise, not a change request. The mark admires the aetiological compression — Icaria named for Icarus, no epitaph, just toponymy. No source edit; held for the cover letter.",
    emptyReason: "praise",
  },
];

// The diff the three actionable marks imply against the edition's LaTeX source.
// Hunks are ordered by line, the way a real `diff -u` would emit them; the
// `@@` headers and surrounding context lines are real lines of the edition so
// the change reads in situ.
export const SAMPLE_RESULT_DIFF: ReadonlyArray<DiffFile> = [
  {
    file: "daedalus-icarus.tex",
    hunks: [
      {
        header: "@@ -42,6 +42,7 @@ \\begin{verse}",
        lines: [
          { kind: "context", text: "Vota Iovi Minos taurorum corpora centum" },
          { kind: "context", text: "solvit, ut egressus ratibus Curetida terram" },
          { kind: "context", text: "contigit, et spoliis decorata est regia fixis." },
          { kind: "context", text: "creverat obprobrium generis, foedumque patebat" },
          {
            kind: "add",
            text: "% app. crit. v. 187: obprobrium (codd.) — forma antiquior; opprobrium edd. plerique.",
          },
          { kind: "context", text: "matris adulterium monstri novitate biformis;" },
          { kind: "context", text: "destinat hunc Minos thalamo removere pudorem" },
        ],
      },
      {
        header: "@@ -58,6 +59,8 @@ \\end{verse}",
        lines: [
          { kind: "context", text: "multiplicique domo caecisque includere tectis." },
          { kind: "context", text: "Daedalus ingenio fabrae celeberrimus artis" },
          {
            kind: "add",
            text: "% comm. v. 195: ingenio, non arte — Daedalus is named for wit, not skill;",
          },
          { kind: "add", text: "%   the choice foreshadows cunning unbound by paternal feeling." },
          { kind: "context", text: "ponit opus turbatque notas et lumina flexum" },
          { kind: "context", text: "ducit in errorem variarum ambage viarum." },
          { kind: "context", text: "" },
        ],
      },
      {
        header: "@@ -71,7 +74,7 @@ \\begin{translation}",
        lines: [
          { kind: "context", text: "He builds the work and muddles the marks, and leads" },
          { kind: "context", text: "the eye astray" },
          { kind: "del", text: "through the winding maze of meandering ways." },
          { kind: "add", text: "through the maze of circuitous deceits." },
          { kind: "context", text: "Not otherwise the limpid Maeander plays" },
          { kind: "context", text: "in Phrygian fields, and slips with doubtful course," },
        ],
      },
    ],
  },
];
