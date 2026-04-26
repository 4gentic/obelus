# @obelus/bundle-builder

**What.** Builds a review bundle — the JSON contract Obelus hands off to the Claude Code plugin — from the rows held in the local store.

**Why.** The bundle is the only thing that ever leaves the device. This package is the single place where annotation rows are shaped into the exported format, so that schema changes propagate through one builder rather than through every UI surface.

**Boundary.** It does not read storage, call the network, or decide when to export. Callers pass in typed row inputs; the builder returns a `Bundle` already parsed against the Zod schema in `@obelus/bundle-schema`. There are no parallel hand-typed duplicates of the schema.

**Public API.**
- `buildBundle(input)` — assemble and validate a bundle from paper, project, and annotation rows; supports cross-format anchors (PDF / Markdown / HTML).
- `suggestBundleFilename(kind, now?)` — canonical filename for a `"review"` or `"revise"` export.
- Input types: `BuildBundleInput`, `PaperRefInput`, `ProjectInput`, `ProjectFileSummaryInput`, `AnnotationInput`, `AnnotationAnchor`, `BundleKind`.
