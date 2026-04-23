# Obelus drafter — Claude Code plugin (preview)

The drafter is a sibling to the Obelus reviewer plugin. The reviewer turns
on-page marks into minimal-diff source edits; the drafter turns a Goal File
into paper sections, one stage at a time.

This is a **preview release.** Only one persona (`research-lead`) and one
command (`/spec`) are wired. The full design — six stages, four personas,
six commands — lives in
[`docs/drafter-design.md`](../../docs/drafter-design.md) at the repo root. The
remaining commands (`/research`, `/draft`, `/critique`, `/drift-check`,
`/assemble`) and personas (`critic`, `literature-scout`, `storyteller`) are
specified there and will land in a follow-up.

## What this plugin does today

- Defines `research-lead`, the persona that drafts and revises paper sections.
- Defines `/spec`, the command that writes a section spec at
  `paper/sections/<NN>-<slug>/spec.md`.

## What it does not do yet

- It does not draft sections (use the design doc; `/draft` is not wired).
- It does not run critiques.
- It does not pull literature.
- It does not write or read the `paper.draft.json` state file. That schema
  lives in `@obelus/drafter-core`; the desktop UI updates the state file
  after a session ends.

## On-disk layout the drafter assumes

```
paper/
  goal.md
  sections/
    01-introduction/
      spec.md
      draft.md
    02-related-work/
      spec.md
      draft.md
    ...
```

One directory per section. The directory's `NN-<slug>` name encodes the
ordinal; the contents are `spec.md` (from `/spec`) and `draft.md` (from
`/draft`, in a follow-up). The draft file extension follows the project's
source format — `.md`, `.tex`, or `.typ`.

## Install

```
/plugin install obelus-drafter@4gentic
```

Or copy `packages/claude-plugin-drafter/` into `.claude/plugins/obelus-drafter/`
inside your paper repo.

## Safety

- The plugin makes no network calls; Claude Code's tools follow the harness
  policy.
- The drafter never edits `paper/goal.md` (the user owns that file) or
  `paper/bibliography.bib` (literature-scout's domain in the full design).

## License

MIT.
