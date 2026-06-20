# @obelus/diff-view

**What.** A pure presentational React component that paints unified-diff hunks with Obelus's editorial styling — file header, hunk header, and added / removed / context lines.

**Why.** The desktop's diff-review pane (`apps/desktop/src/routes/project`) renders diffs, but its `HunkBlock` is coupled to `@obelus/repo` rows, accept/reject state, and edit affordances. The web "see the result" demo needs the same visual language with none of that machinery. This package isolates the rendering so any read-only surface can show a diff without pulling in storage or IPC.

**Public API.**
- `<DiffHunks files={DiffFile[]} />` — paints the supplied files.
- Types: `DiffFile { file; hunks }`, `DiffHunk { header?; lines }`, `DiffLine { kind: "add" | "del" | "context"; text }`.

**Boundary.** Props only. No stores, no IPC, no router, no `@obelus/repo`. Ships its own CSS (`@obelus/diff-view/diff-view.css`) which reads colour and spacing tokens from `@obelus/design-tokens`; import the tokens at the app level.
