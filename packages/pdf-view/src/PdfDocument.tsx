import type { PDFDocumentProxy } from "pdfjs-dist";
import { type ReactNode, useMemo } from "react";
import PdfPage from "./PdfPage";
import "./pdf.css";

import type { JSX } from "react";

type Props = {
  doc: PDFDocumentProxy;
  scale: number;
  renderPageOverlay?: (pageIndex: number, scale: number) => ReactNode;
};

export default function PdfDocument({ doc, scale, renderPageOverlay }: Props): JSX.Element {
  const pageCount = doc.numPages;

  const pageIndexes = useMemo(() => Array.from({ length: pageCount }, (_, i) => i), [pageCount]);

  return (
    <div className="pdf-doc">
      {pageIndexes.map((i) => (
        <div key={i} className="pdf-doc__slot" data-page-slot={i}>
          <PdfPage
            doc={doc}
            pageIndex={i}
            scale={scale}
            overlay={renderPageOverlay ? renderPageOverlay(i, scale) : null}
          />
        </div>
      ))}
    </div>
  );
}
