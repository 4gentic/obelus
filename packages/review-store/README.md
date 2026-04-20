# @obelus/review-store

**What.** The Zustand store that holds the in-progress review for a single revision: the annotation list, the current draft selection, the draft category and note, and the focused annotation.

**Why.** Reviewing a PDF is stateful in a way that spans several components — the PDF pane, the margin gutter, the review pane, the category picker. A shared store means each surface reads and writes the same truth, with undo/redo via zundo and persistence handled by the repository it is wired to.

**Boundary.** This package owns ephemeral review state. Durable rows live in `@obelus/repo`; the store calls into an injected `AnnotationsRepo` for reads and writes. It does not render, does not know about PDF rendering, and does not build bundles.

**Public API.**
- `createReviewStore` — factory that returns a bound Zustand store given an `AnnotationsRepo`.
- Types: `ReviewState`, `DraftInput`, `DraftSlice`.
