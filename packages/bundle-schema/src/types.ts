import type { z } from "zod";
import type { AnnotationV1, BundleV1, CategoryV1 } from "./schema.js";

export type Bundle = z.infer<typeof BundleV1>;
export type Annotation = z.infer<typeof AnnotationV1>;
export type Category = z.infer<typeof CategoryV1>;
export type PdfRef = Bundle["pdf"];
export type PaperRef = Bundle["paper"];
export type Thread = Annotation["thread"];
