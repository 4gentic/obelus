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

// Vertical inset (top + bottom, fraction of the line-cell). Without it,
// adjacent line rects touch — the highlight reads as a slab fill instead of
// per-line marks. ~12% on each side gives a ~24% gap between rows, matching
// the breathing room a native HTML ::selection gets via line-height padding.
const LINE_INSET_RATIO = 0.12;

// Groups per-item rects into one rect per visual line by bucketing on the
// y-baseline. pdfjs gives every item on the same line the same `y` to within
// sub-pixel precision; we bucket on `round(y)` for safety. When `minLineHeight`
// is given, body-text lines bump up to it so a paragraph's per-line rects share
// a uniform height — eliminates the jagged "g made this line taller than the
// next one" feel. Headers and large-font runs keep their native height because
// we only enlarge, never shrink. Each rect is then inset symmetrically so
// adjacent rows don't touch.
function mergeByLine(rects: ReadonlyArray<Bbox>, minLineHeight?: number): Bbox[] {
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
    .map((b) => {
      const fullH = minLineHeight !== undefined && minLineHeight > b.h ? minLineHeight : b.h;
      const inset = fullH * LINE_INSET_RATIO;
      return [b.minX, b.y + inset, b.maxX - b.minX, fullH - inset * 2] as Bbox;
    });
}

// Median baseline-to-baseline distance across all items on the page. Used to
// give a paragraph's lines a uniform highlight height. We sort unique line
// y-tops and take the median consecutive delta; the median rejects outliers
// from column gaps and figure captions. Returns null when the page has fewer
// than two distinct lines (single-line pages, sparse decorative layouts).
function pageLineHeight(items: ReadonlyArray<TextItem>, viewport: PageViewport): number | null {
  const tops = new Set<number>();
  for (const item of items) {
    if (item.str === "" || item.width <= 0) continue;
    const r = textItemToRect(item, viewport);
    tops.add(Math.round(r.y));
  }
  if (tops.size < 2) return null;
  const sorted = Array.from(tops).sort((a, b) => a - b);
  const diffs: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (a === undefined || b === undefined) continue;
    const d = b - a;
    // Sanity bracket: real lines sit between roughly 6px (tiny figure caption)
    // and 80px (oversized display heading). Outside that, we're crossing a
    // column or a paragraph gap — those entries shouldn't pollute the median.
    if (d >= 6 && d <= 80) diffs.push(d);
  }
  if (diffs.length === 0) return null;
  diffs.sort((a, b) => a - b);
  const mid = Math.floor(diffs.length / 2);
  return diffs[mid] ?? null;
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
  const lineHeight = pageLineHeight(items, viewport);
  return lineHeight !== null ? mergeByLine(raw, lineHeight) : mergeByLine(raw);
}
