# @obelus/pdf-view

**What.** React components that render a PDF and its selectable text layer, plus the pdf.js worker bootstrap. The view layer of the reviewer.

**Why.** pdf.js exposes a rendering pipeline but not a cohesive React surface. This package wraps it into a small set of components — `PdfDocument`, `PdfPage`, `SelectionListener` — so that the app code never touches pdf.js internals directly, and worker setup is hidden behind a single `loadDocument` call.

**Boundary.** This package renders; it does not anchor (`@obelus/anchor` does), does not persist, and does not know about annotations as entities. The text layer is built via `pdfjs-dist/web/text_layer_builder`; rectangles are computed from transform matrices, not from `getBoundingClientRect`.

**Public API.**
- `PdfDocument` — load and hold a pdf.js document.
- `PdfPage` — render one page with its text layer.
- `SelectionListener` — observe text selection on a mounted page.
- `loadDocument` — boot the pdf.js worker and open a document from bytes.
- `MAX_PDF_BYTES`, `MAX_PDF_BYTES_LABEL` — the upload-size ceiling.
