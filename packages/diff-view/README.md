# @obelus/diff-view

**What.** Renders a stored unified-diff hunk as manuscript track-changes — a serif redline at reading width, removed text struck in terracotta and added text underlined in sage, rather than a `@@`/`+`/`-` unified diff. Pure functions for the change model plus one presentational component.

**Why.** The desktop's diff-review pane and the web "see the result" demo both show the edits an AI engine proposes. The persisted shape stays a unified-diff string (`DiffHunkRow.modifiedPatchText`), but the reader should see a marked-up sentence, not diff syntax. This package isolates the rendering and the patch math so any surface can show — and re-synthesize — a change without pulling in storage or IPC.

**Public API.**
- `<InlineChange patch={string} sourceText={string | null} />` — paints one hunk as a redline. With `sourceText`, the original lines and a little surrounding context are read from source; without it, they are reconstructed from the patch body. Large or structural changes fall back to clean before/after blocks.
- `parseChange(patch, sourceText): ParsedChange | null` — the `before` / `after` / context model behind the component.
- `synthesizePatch(sourceText, originalPatch, editedAfter): string` — turn an edited "after" back into a unified-diff hunk (same `@@`-only shape the rest of the system stores), so editing the prose never means editing diff syntax.

**Boundary.** Props and plain values only. No stores, no IPC, no router, no `@obelus/repo`. Depends on `diff` (jsdiff) for word-level runs and patch synthesis. Ships its own CSS (`@obelus/diff-view/diff-view.css`) which reads colour and spacing tokens from `@obelus/design-tokens`; import the tokens at the app level.
