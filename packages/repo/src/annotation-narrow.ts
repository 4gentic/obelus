import type { AnnotationRow, PdfAnchoredAnnotation } from "./types";

// A PDF paper's annotations always carry `page` + `bbox` + `textItemRange`.
// An MD paper's annotations carry `sourceAnchor` instead and leave the PDF
// coordinate fields unset. These helpers let a PDF-specific consumer narrow
// AnnotationRow[] to the subset it can render.
export type AnnotationPdfRow = AnnotationRow & PdfAnchoredAnnotation;

export function isPdfAnchored(row: AnnotationRow): row is AnnotationPdfRow {
  return row.page !== undefined && row.bbox !== undefined && row.textItemRange !== undefined;
}
