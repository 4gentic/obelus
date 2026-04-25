# @obelus/bundle-schema

**What.** The Zod schema for the Obelus review bundle. One source of truth, versioned, exported as both the runtime validator and the static type. Ships a generated JSON Schema for external consumers.

**Why.** The bundle is the contract between the web app (producer) and the Claude Code plugin (consumer). One schema at the boundary means one place to change when the contract changes — no hand-typed duplicates drifting out of sync.

**Boundary.** This package defines shapes and parses incoming bundles. It does not build bundles (that's [`@obelus/bundle-builder`](../bundle-builder)), read files, or depend on any DOM. Version bumps land here first; migrations between versions ship alongside.

## Public API

- `Bundle`, `Annotation`, `BUNDLE_VERSION`, `Anchor`, `PdfAnchor`, `HtmlAnchor`, `HtmlElementAnchor`, `SourceAnchor`, `PaperRef`, `PaperRubric`, `Project`, `ProjectCategory`, `ProjectKind`, `ProjectFileFormat`, `ProjectFileRole`, `ProjectFileSummary`, `Thread` — the bundle schema and its sub-types.
- `parseBundle(input)` — parser returning a discriminated `ParseResult`. Use this at every consumer boundary.
- Sibling artifacts: `ProjectMeta`, `CompileErrorBundle` (and their version literals), exported alongside.

## JSON Schema

The bundle is emitted as a JSON Schema artifact during the package build and exported via a subpath for consumers that validate outside a Zod runtime (notably the Claude Code plugin):

```ts
import bundleSchema from "@obelus/bundle-schema/json-schema/bundle";
```

## Usage

```ts
import { parseBundle } from "@obelus/bundle-schema";

const raw = JSON.parse(await readFile("bundle.json", "utf8"));
const result = parseBundle(raw);

if (result.ok) {
  // result.value is Bundle.
} else {
  // result.error is a ZodError; surface or log it.
}
```
