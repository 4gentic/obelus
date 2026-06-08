import { PageNavField } from "@obelus/review-shell";
import "@obelus/review-shell/review-shell.css";
import type { JSX } from "react";
import { useDocumentScroll } from "./document-scroll-context";

// Thin host over the shared PageNavField: reads the page-nav provider the PDF
// surface lifted into document-scroll-context. Kept separate from
// PdfZoomControls so a scroll tick re-renders only the indicator, never the
// zoom-store-driven controls. Hidden for single-page documents.
export default function PdfPageControls(): JSX.Element | null {
  const { pages } = useDocumentScroll();
  if (!pages || pages.count <= 1) return null;
  return <PageNavField provider={pages} className="pdf-pagenav" />;
}
