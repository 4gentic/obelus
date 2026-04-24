# @obelus/md-view

**What.** React component that renders a markdown paper into Obelus's review surface.

**Why.** PDFs have `@obelus/pdf-view`; markdown papers need the equivalent — a layout-stable preview whose DOM carries source-position attributes so `selectionToSourceAnchor` (in `@obelus/anchor`) can resolve user selections back to `{ file, lineStart, lineEnd, colStart, colEnd }` in the original `.md`.

**Public API.**
- `<MarkdownView />` — renders the given markdown text; exposes an imperative ref to the container element so a `SelectionListener` can attach.

**Stack.**
- Rendering delegated to `renderMarkdown` from `@obelus/source-render/browser` (pure JS — mdast/hast/micromark). No Node deps, no runtime network.
- The rendered HTML includes `data-src-file`, `data-src-line`, `data-src-end-line`, `data-src-col` on every leaf block element, which is the contract `selectionToSourceAnchor` expects.

**Boundary.** Browser-safe. Imported by `apps/web`. Does not read from OPFS or IndexedDB — the caller hands in `{ file, text }`.
