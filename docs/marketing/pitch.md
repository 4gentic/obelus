# Pitch

Four forms. Pick the one that fits the context. Each is calibrated to the
product's claim and the voice in the rest of `docs/marketing/` — editorial,
unhyped, no exclamation points.

## One-liner (≤120 chars)

> Obelus is an offline review surface for AI-assisted papers. Mark what you doubt; Claude Code fixes the source.

Variants — same beat, different axis:

- *Privacy-first.* "Your draft, your device. Obelus reviews PDFs in the browser and hands Claude Code a single file to apply."
- *Self-review.* "When the model writes the paper, you become the reviewer. Obelus is the surface for that work."
- *Format-agnostic.* "One review workflow for LaTeX, Markdown, and Typst. No cloud."

## 30-second elevator

Writing a paper with AI is cheap. Reviewing what the model wrote is the
work, and it is the work most tools still pretend isn't there. Obelus is
an offline, browser-only review surface: you open your PDF, highlight
what needs attention, categorize it, write a margin note. You export a
single file — a review bundle — drop it in your paper's repo, and run
one Claude Code command. The plugin detects your source format, locates
each passage in the source, and proposes a minimal diff. Nothing ever
leaves your machine except, optionally, a scalar `+1` to a public
counter. The product is the loop between your judgment and the model's
prose, and it keeps that loop private.

## 2-minute investor / talk pitch

**The inverted economics of AI-authored writing.** When a model drafts
most of a paper, writing time collapses from weeks to hours. Review
time does not. It gets harder — because the prose reads confident even
when it's wrong, because you did not build the argument yourself, and
because most tooling was designed for the old ratio where you wrote
and someone else reviewed.

**What Obelus is.** Two halves connected by a file. The first half is
a web app — open, offline, no account — where you review your PDF the
way reviewers have always reviewed PDFs: highlight a passage, pick a
category (unclear, wrong, weak argument, citation needed, praise),
write a margin note. The app runs entirely in your browser. PDFs live
in the browser's origin-private filesystem. Annotations live in
IndexedDB. Nothing is uploaded.

The second half is a Claude Code plugin. You export a review bundle —
a single JSON file that describes every mark with enough context to
locate it in source. You drop the bundle in your paper's repository
and run one command. The plugin detects your source format — LaTeX,
Markdown, or Typst — locates each passage, proposes a minimal diff,
and on your confirmation applies it.

**Why this order matters.** Reviewing in the PDF, editing in the
source. Most tools conflate the two, which is why their output reads
like the model wrote it. Obelus keeps them separate: your judgment
lives in the margin; the model's prose lives in the source; the
bundle is the strict, inspectable contract between them.

**Privacy as the first feature, not the marketing one.** The
web app makes one optional network call — a scalar `+1` to a public
counter when you export a bundle, off by default. The counter's
source is a few dozen lines of open code on a serverless runtime
you can audit. There is no account, no sync, no telemetry, no
fingerprint. Clear your site data and Obelus is gone from the
internet.

**What we are building.** The open-source product first. A
frictionless launch, a counter that cannot lie because it cannot
know anything, and a user base of researchers and technical writers
who feel the review-heavy shape of post-AI authorship sharply.
Later: a CRDT sync layer for co-reviewers, export to JATS / DOCX
tracked-changes for journals that do not run on git, and a teams
layer for lab groups. None of that compromises the local-first core.

## Deck outline (7 slides)

1. **The shift.** Writing cost has collapsed. Review cost has not. A
   single chart if you have one, otherwise a numbered claim.
2. **What people actually do now.** Model drafts a paper; author reads
   it three times looking for bullshit; corrections happen in the
   source, not the model output. Show a stylised loop.
3. **Why existing tools miss this.** PDF tools assume you are the
   reader, not the author. Track-changes tools assume collaboration
   with another human. Neither surface helps you review prose you
   didn't write.
4. **Obelus in one screen.** Three columns: PDF, margin gutter,
   review pane. Show the actual UI.
5. **The bundle is the contract.** One JSON file. Four arrows:
   browser → bundle → Claude Code → source. Show the Zod schema.
6. **Privacy posture.** A bulleted contract: OPFS-only storage, no
   telemetry, one opt-in scalar counter, open-source Worker. Explain
   why this is a feature and not a compromise.
7. **Ask.** If talking to researchers: try it on your next paper, in
   three formats. If talking to an investor: we are open-sourcing the
   core, building the team-and-sync layer, and the pitch ends here.

## What not to say

- "AI-powered" — Obelus is not AI-powered. It is the surface you use
  to review AI output.
- "Revolutionary," "game-changing," "disruptive."
- Anything that implies you need to trust us. The product is local.
- Emoji anywhere in the pitch materials.
