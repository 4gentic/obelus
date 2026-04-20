# @obelus/bundle-schema

**What.** The Zod schema for the Obelus review bundle. One source of truth, versioned, exported as both the runtime validator and the static type. Ships a generated JSON Schema for external consumers.

**Why.** The bundle is the contract between the web app (producer) and the Claude Code plugin (consumer). One schema at the boundary means one place to change when the contract changes — no hand-typed duplicates drifting out of sync.

**Boundary.** This package defines shapes and parses incoming bundles. It does not build bundles (that's [`@obelus/bundle-builder`](../bundle-builder)), read files, or depend on any DOM. Version bumps land here first; migrations between versions ship alongside.

## Versions

- **v1** — legacy envelope; scale-aware PDF rects. Kept for rolling imports.
- **v2** — current. Source-anchor primitives (`PdfAnchor`, `HtmlAnchor`, `SourceAnchor`) + NFKC-normalized quote + ~200-char context triplets for robust re-anchoring in source.

The envelope's `bundleVersion` is a `z.literal()` (`"1.0"` or `"2.0"`). Breaking changes bump the literal and ship a migration file.

## Public API

- `BundleV1`, `AnnotationV1`, `CategoryV1`, `BUNDLE_VERSION` — v1 schema and literal.
- `BundleV2`, `AnnotationV2`, `BUNDLE_VERSION_V2`, `Anchor`, `PdfAnchor`, `HtmlAnchor`, `SourceAnchor`, `ProjectCategory`, `ProjectKind` — v2 schema.
- `parseBundle(input)` — version-aware parser returning a discriminated `ParseResult`. Use this at every consumer boundary.
- Types: `Bundle`, `Annotation`, `Category`, `PaperRef`, `PdfRef`, `Thread`, plus `*2` variants for v2.

## JSON Schema

Both versions are emitted as JSON Schema artifacts during the package build and exported via subpaths for consumers that validate outside a Zod runtime (notably the Claude Code plugin):

```ts
import v1 from "@obelus/bundle-schema/json-schema/v1";
import v2 from "@obelus/bundle-schema/json-schema/v2";
```

## Usage

```ts
import { parseBundle } from "@obelus/bundle-schema";

const raw = JSON.parse(await readFile("bundle.json", "utf8"));
const result = parseBundle(raw);

if (result.ok) {
  // result.value is BundleV1 | BundleV2 depending on the envelope version.
} else {
  // result.error is a ZodError; surface or log it.
}
```
