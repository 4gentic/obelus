import type { TextItem } from "pdfjs-dist/types/src/display/api";
import type { Anchor } from "./types";

// What counts as a word boundary. Whitespace + Unicode punctuation. The hyphen
// inside "non-trivial" is `\p{P}`, so the snap stops there — selecting inside
// "trivial" gives you "trivial", not "non-trivial". That matches what the
// browser's native double-click word-select would do, which is the behavior
// users expect.
const BOUNDARY_RE = /[\s\p{P}]/u;

function isBoundary(ch: string): boolean {
  return ch === "" || BOUNDARY_RE.test(ch);
}

// Two items are on the same visual line when their baseline y (PDF-space, the
// 6th transform entry) is within half a point of each other. pdfjs hands the
// same `transform[5]` to every item on the same line; the tolerance just
// guards against accumulated FP error in the rare composed-transform case.
function sameLine(a: TextItem, b: TextItem): boolean {
  const ay = a.transform[5] ?? 0;
  const by = b.transform[5] ?? 0;
  return Math.abs(ay - by) < 0.5;
}

// Snap an anchor's start backward to the nearest word boundary, and its end
// forward to the nearest word boundary. Walks across adjacent items on the
// same visual line — pdfjs splits a single rendered word into multiple items
// across font/style runs, so word-internal item boundaries are common.
//
// No-op when the anchor is already at boundaries on both sides. Never extends
// across a line break or beyond the items array.
export function snapToWordBounds(anchor: Anchor, items: ReadonlyArray<TextItem>): Anchor {
  // --- Backward snap on start ---
  let si = anchor.startItem;
  let so = anchor.startOffset;
  // Hard cap to prevent any pathological loop.
  for (let guard = 0; guard < 4096; guard += 1) {
    const item = items[si];
    if (!item) break;
    if (so === 0) {
      if (si === 0) break;
      const prev = items[si - 1];
      if (!prev || !sameLine(item, prev)) break;
      const prevLast = prev.str[prev.str.length - 1] ?? "";
      if (isBoundary(prevLast)) break;
      // Hop into the previous item, continue scanning from its tail.
      si -= 1;
      so = prev.str.length;
      continue;
    }
    const ch = item.str[so - 1] ?? "";
    if (isBoundary(ch)) break;
    so -= 1;
  }

  // --- Forward snap on end ---
  let ei = anchor.endItem;
  let eo = anchor.endOffset;
  for (let guard = 0; guard < 4096; guard += 1) {
    const item = items[ei];
    if (!item) break;
    if (eo >= item.str.length) {
      const next = items[ei + 1];
      if (!next || !sameLine(item, next)) break;
      const nextFirst = next.str[0] ?? "";
      if (isBoundary(nextFirst)) break;
      ei += 1;
      eo = 0;
      continue;
    }
    const ch = item.str[eo] ?? "";
    if (isBoundary(ch)) break;
    eo += 1;
  }

  if (si > ei) return anchor;
  if (si === ei && so >= eo) return anchor;

  return {
    pageIndex: anchor.pageIndex,
    startItem: si,
    startOffset: so,
    endItem: ei,
    endOffset: eo,
  };
}
