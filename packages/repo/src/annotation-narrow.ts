import type { AnnotationRow, PdfAnchorFields } from "./types";

// A PDF paper's annotations carry an `anchor` whose `kind === "pdf"`; an MD
// paper's annotations carry `kind === "source"`. This guard lets a PDF-only
// consumer narrow AnnotationRow[] to the subset it can render in one step.
export type AnnotationPdfRow = AnnotationRow & { anchor: PdfAnchorFields };

export function isPdfAnchored(row: AnnotationRow): row is AnnotationPdfRow {
  return row.anchor.kind === "pdf";
}
