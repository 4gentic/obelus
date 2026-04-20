# @obelus/anchor

**What.** Stable anchoring for selections made on top of a rendered PDF, so that the same passage can be re-located later regardless of re-rendering or scale.

**Why.** An annotation is only useful if it still points at the right passage the next time the PDF is opened. Anchoring stores the selection in a form that survives re-layout and does not depend on DOM coordinates.

**Boundary.** Anchors are computed from pdf.js text-item streams and stored in PDF-point space. This package does not render PDFs, own the selection UI, or persist anything. It is consumed by `@obelus/pdf-view` for rendering-time rect reconstruction and by `@obelus/bundle-builder` for export.

**Public API.**
- `snapshotEndpoint`, `resolveEndpointToAnchor`, `planPage`, `pageIndexOf` — build and resolve anchors from a pdf.js page.
- `rectsFromAnchor` — reconstruct highlight rectangles for a known anchor.
- `textItemToRect` — convert a pdf.js text item transform to a rect.
- `selectionToSourceAnchor`, `verifySourceAnchor` — anchor into source text.
- `selectionToHtmlAnchor`, `verifyHtmlAnchor` — anchor into rendered HTML.
- `extract`, `CONTEXT_WINDOW` — extract a quote with stable before/after context.
- `normalizeQuote` — NFKC-normalize a quote for storage.
- Types: `Anchor`, `Bbox`, `Rect`, `PageSnapshot`, `EndpointSnapshot`, `CrossPageEndpoint`.
