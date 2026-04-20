import type { PageViewport } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { textItemToRect } from "./coords";
import type { Anchor, Bbox } from "./types";

// Character-proportional slicing: glyph widths aren't available without DOM
// measurement, so we approximate by `(chars / item.str.length) * item.width`.
// For monospace runs this is exact; for proportional fonts it drifts a few
// pixels per word — acceptable for a highlight overlay, not for cursor math.
function sliceItemRect(
  item: TextItem,
  viewport: PageViewport,
  fromOffset: number,
  toOffset: number,
): Bbox | null {
  const len = item.str.length;
  if (len === 0 || toOffset <= fromOffset) return null;
  const base = textItemToRect(item, viewport);
  const leadRatio = Math.max(0, Math.min(1, fromOffset / len));
  const trailRatio = Math.max(0, Math.min(1, toOffset / len));
  const x = base.x + leadRatio * base.w;
  const w = (trailRatio - leadRatio) * base.w;
  if (w <= 0) return null;
  return [x, base.y, w, base.h] as const;
}

// Groups per-item rects into one rect per visual line by bucketing on the
// y-baseline. pdfjs gives every item on the same line the same `y` to within
// sub-pixel precision; we bucket on `round(y)` for safety.
function mergeByLine(rects: ReadonlyArray<Bbox>): Bbox[] {
  const buckets = new Map<number, { minX: number; maxX: number; y: number; h: number }>();
  for (const [x, y, w, h] of rects) {
    const key = Math.round(y);
    const existing = buckets.get(key);
    if (existing) {
      if (x < existing.minX) existing.minX = x;
      if (x + w > existing.maxX) existing.maxX = x + w;
      if (h > existing.h) existing.h = h;
    } else {
      buckets.set(key, { minX: x, maxX: x + w, y, h });
    }
  }
  return Array.from(buckets.values())
    .sort((a, b) => a.y - b.y)
    .map((b) => [b.minX, b.y, b.maxX - b.minX, b.h] as Bbox);
}

export function rectsFromAnchor(
  anchor: Anchor,
  items: ReadonlyArray<TextItem>,
  viewport: PageViewport,
): Bbox[] {
  const raw: Bbox[] = [];
  for (let i = anchor.startItem; i <= anchor.endItem; i += 1) {
    const item = items[i];
    if (!item) continue;
    const from = i === anchor.startItem ? anchor.startOffset : 0;
    const to = i === anchor.endItem ? anchor.endOffset : item.str.length;
    const r = sliceItemRect(item, viewport, from, to);
    if (r) raw.push(r);
  }
  return mergeByLine(raw);
}
