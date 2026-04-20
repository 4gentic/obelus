import type { PageViewport } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

export type Rect = { x: number; y: number; w: number; h: number };

// pdfjs text-item `transform` is a 6-value affine in PDF space (origin bottom-left).
// Entries [0] and [3] are the glyph-run x- and y-scales (ie. font size); [4]/[5] are
// the baseline origin. `convertToViewportRectangle` handles the y-flip and CSS zoom in
// one shot — hand-rolling this math drifts at fractional scales.
export function textItemToRect(item: TextItem, viewport: PageViewport): Rect {
  const tx = item.transform;
  const fontHeight = Math.hypot(tx[2] ?? 0, tx[3] ?? 0);
  const originX = tx[4] ?? 0;
  const originY = tx[5] ?? 0;
  const width = item.width;

  const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([
    originX,
    originY,
    originX + width,
    originY + fontHeight,
  ]);

  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);
  return { x, y, w, h };
}
