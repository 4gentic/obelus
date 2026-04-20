import type { PageViewport } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { normalizeQuote } from "./anchor";
import { textItemToRect } from "./coords";
import type { Anchor, Bbox } from "./types";

export const CONTEXT_WINDOW = 200;

type Extraction = {
  quote: string;
  contextBefore: string;
  contextAfter: string;
  bbox: Bbox;
};

// pdfjs emits one TextItem per run — a font/italic boundary or line wrap
// produces a new item. `hasEOL` only fires at explicit line breaks, so
// adjacent items on the same visual line with a kerning gap would otherwise
// glue together ("runtime" + "whose" → "runtimewhose"). We use the transform
// matrix to detect a visual gap and insert a space; normalizeQuote collapses
// any resulting run of whitespace (including the \n we emit on hasEOL).
function shouldSeparate(prev: TextItem, curr: TextItem): boolean {
  const pt = prev.transform;
  const ct = curr.transform;
  const fontSize = Math.hypot(pt[2] ?? 0, pt[3] ?? 0) || 1;
  const prevY = pt[5] ?? 0;
  const currY = ct[5] ?? 0;
  if (Math.abs(currY - prevY) > 0.5 * fontSize) return true;

  const prevRight = (pt[4] ?? 0) + prev.width;
  const currLeft = ct[4] ?? 0;
  const gap = currLeft - prevRight;
  if (gap > 0.2 * fontSize) return true;

  const prevEndsNonSpace = prev.str.length > 0 && !/\s$/.test(prev.str);
  const currStartsNonSpace = curr.str.length > 0 && !/^\s/.test(curr.str);
  return gap > 0.01 * fontSize && prevEndsNonSpace && currStartsNonSpace;
}

function sliceItems(
  items: ReadonlyArray<TextItem>,
  startItem: number,
  startOffset: number,
  endItem: number,
  endOffset: number,
): string {
  const parts: string[] = [];
  for (let i = startItem; i <= endItem; i += 1) {
    const it = items[i];
    if (!it) continue;
    if (i > startItem) {
      const prev = items[i - 1];
      if (prev) {
        if (prev.hasEOL) parts.push("\n");
        else if (shouldSeparate(prev, it)) parts.push(" ");
      }
    }
    const from = i === startItem ? startOffset : 0;
    const to = i === endItem ? endOffset : it.str.length;
    if (to > from) parts.push(it.str.slice(from, to));
  }
  return parts.join("");
}

// Walks backwards from an item/offset accumulating up to `window` characters.
function collectBefore(
  items: ReadonlyArray<TextItem>,
  startItem: number,
  startOffset: number,
  window: number,
): string {
  const chunks: string[] = [];
  let remaining = window;

  const first = items[startItem];
  if (first) {
    const headLen = Math.min(startOffset, remaining);
    if (headLen > 0) {
      chunks.push(first.str.slice(startOffset - headLen, startOffset));
      remaining -= headLen;
    }
  }

  for (let i = startItem - 1; i >= 0 && remaining > 0; i -= 1) {
    const it = items[i];
    if (!it) continue;
    const next = items[i + 1];
    if (next) {
      if (it.hasEOL) {
        chunks.push("\n");
        remaining -= 1;
        if (remaining <= 0) break;
      } else if (shouldSeparate(it, next)) {
        chunks.push(" ");
        remaining -= 1;
        if (remaining <= 0) break;
      }
    }
    const take = Math.min(it.str.length, remaining);
    if (take > 0) {
      chunks.push(it.str.slice(it.str.length - take));
      remaining -= take;
    }
  }
  return chunks.reverse().join("");
}

function collectAfter(
  items: ReadonlyArray<TextItem>,
  endItem: number,
  endOffset: number,
  window: number,
): string {
  const chunks: string[] = [];
  let remaining = window;

  const last = items[endItem];
  if (last) {
    const tail = last.str.slice(endOffset, endOffset + remaining);
    if (tail.length > 0) {
      chunks.push(tail);
      remaining -= tail.length;
    }
  }

  for (let i = endItem + 1; i < items.length && remaining > 0; i += 1) {
    const it = items[i];
    if (!it) continue;
    const prev = items[i - 1];
    if (prev) {
      if (prev.hasEOL) {
        chunks.push("\n");
        remaining -= 1;
        if (remaining <= 0) break;
      } else if (shouldSeparate(prev, it)) {
        chunks.push(" ");
        remaining -= 1;
        if (remaining <= 0) break;
      }
    }
    const take = Math.min(it.str.length, remaining);
    if (take > 0) {
      chunks.push(it.str.slice(0, take));
      remaining -= take;
    }
  }
  return chunks.join("");
}

// Tight bbox over every text-item the selection touches. Pure in the text-item
// data (items + viewport), independent of DOM layout.
function computeBbox(
  items: ReadonlyArray<TextItem>,
  viewport: PageViewport,
  startItem: number,
  endItem: number,
): Bbox {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let i = startItem; i <= endItem; i += 1) {
    const it = items[i];
    if (!it) continue;
    const r = textItemToRect(it, viewport);
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.w > maxX) maxX = r.x + r.w;
    if (r.y + r.h > maxY) maxY = r.y + r.h;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return [0, 0, 0, 0] as const;
  }
  return [minX, minY, maxX - minX, maxY - minY] as const;
}

export function extract(
  anchor: Anchor,
  items: ReadonlyArray<TextItem>,
  viewport: PageViewport,
): Extraction {
  const raw = sliceItems(
    items,
    anchor.startItem,
    anchor.startOffset,
    anchor.endItem,
    anchor.endOffset,
  );
  const quote = normalizeQuote(raw);
  const contextBefore = normalizeQuote(
    collectBefore(items, anchor.startItem, anchor.startOffset, CONTEXT_WINDOW),
  );
  const contextAfter = normalizeQuote(
    collectAfter(items, anchor.endItem, anchor.endOffset, CONTEXT_WINDOW),
  );
  const bbox = computeBbox(items, viewport, anchor.startItem, anchor.endItem);

  return { quote, contextBefore, contextAfter, bbox };
}
