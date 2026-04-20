import type { z } from "zod";
import type {
  Anchor,
  AnnotationV2,
  BundleV2,
  HtmlAnchor,
  PdfAnchor,
  ProjectCategory,
  ProjectKind,
  SourceAnchor,
} from "./schema-v2.js";

export type Bundle2 = z.infer<typeof BundleV2>;
export type Annotation2 = z.infer<typeof AnnotationV2>;
export type Anchor2 = z.infer<typeof Anchor>;
export type PdfAnchor2 = z.infer<typeof PdfAnchor>;
export type SourceAnchor2 = z.infer<typeof SourceAnchor>;
export type HtmlAnchor2 = z.infer<typeof HtmlAnchor>;
export type ProjectCategory2 = z.infer<typeof ProjectCategory>;
export type ProjectKind2 = z.infer<typeof ProjectKind>;
export type PaperRef2 = Bundle2["papers"][number];
export type Project2 = Bundle2["project"];
