export { migrateV1ToV2 } from "./migrations.js";
export type { ParseResult } from "./parse.js";
export { parseBundle } from "./parse.js";
export { AnnotationV1, BUNDLE_VERSION, BundleV1, CategoryV1 } from "./schema.js";
export {
  Anchor,
  AnnotationV2,
  BUNDLE_VERSION_V2,
  BundleV2,
  HtmlAnchor,
  PdfAnchor,
  ProjectCategory,
  ProjectKind,
  SourceAnchor,
} from "./schema-v2.js";
export type { Annotation, Bundle, Category, PaperRef, PdfRef, Thread } from "./types.js";
export type {
  Anchor2,
  Annotation2,
  Bundle2,
  HtmlAnchor2,
  PaperRef2,
  PdfAnchor2,
  Project2,
  ProjectCategory2,
  ProjectKind2,
  SourceAnchor2,
} from "./types-v2.js";
