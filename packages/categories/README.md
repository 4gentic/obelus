# @obelus/categories

**What.** The canonical list of annotation categories — `unclear`, `wrong`, `weak-argument`, `citation-needed`, `rephrase`, `praise` — and their display metadata.

**Why.** Categories are a small, stable vocabulary. Centralising them keeps the UI labels, the highlight-colour tokens, and the bundle schema enum in one place. The category ids flow through as literal strings, validated at the bundle boundary.

**Boundary.** This package does not render highlights or own the tokens themselves (see `@obelus/design-tokens`). It re-exports the `Category` type from the bundle schema so there is no duplicate source of truth.

**Public API.**
- `DEFAULT_CATEGORIES` — the ordered list of `CategoryMeta` records (`id`, `label`, `tokenVar`).
- Types: `Category` (re-exported from `@obelus/bundle-schema`), `CategoryMeta`.
