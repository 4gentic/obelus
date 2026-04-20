# @obelus/bundle-schema

**What.** The Zod schema for the Obelus review bundle. Versioned, with a literal `bundleVersion` field, and exported as both the runtime validator and the static type.

**Why.** The bundle is the contract between the web app and the Claude Code plugin. One schema at the boundary means one place to change when the contract changes — no hand-typed duplicates drifting out of sync.

**Boundary.** This package defines shapes and parses incoming bundles. It does not build bundles (see `@obelus/bundle-builder`), read files, or depend on any DOM. Version bumps land here first; migrations between versions are shipped alongside.

**Public API.**
- `BundleV1`, `AnnotationV1`, `CategoryV1`, `BUNDLE_VERSION` — v1 schema and literal.
- `BundleV2`, `AnnotationV2`, `BUNDLE_VERSION_V2`, `Anchor`, `PdfAnchor`, `HtmlAnchor`, `SourceAnchor`, `ProjectCategory`, `ProjectKind` — v2 schema.
- `parseBundle` — version-aware parser returning a discriminated `ParseResult`.
- Types: `Bundle`, `Annotation`, `Category`, `PaperRef`, `PdfRef`, `Thread`, plus the `*2` variants for v2.
