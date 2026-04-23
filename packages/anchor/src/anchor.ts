import type { TextItem } from "pdfjs-dist/types/src/display/api";
import type { Anchor } from "./types";

// The text_layer_builder tags each rendered span with the originating item
// index via a data attribute. We walk up from the selection's anchor/focus
// nodes (which are usually text nodes inside a span) to find it.
const ITEM_INDEX_ATTR = "data-item-index";

export function findItemIndex(node: Node | null): number | null {
  let current: Node | null = node;
  while (current) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const el = current as Element;
      const raw = el.getAttribute(ITEM_INDEX_ATTR);
      if (raw !== null) {
        const parsed = Number.parseInt(raw, 10);
        return Number.isNaN(parsed) ? null : parsed;
      }
    }
    current = current.parentNode;
  }
  return null;
}

export function pageIndexOf(node: Node | null): number | null {
  let current: Node | null = node;
  while (current) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const el = current as Element;
      const raw = el.getAttribute("data-page-index");
      if (raw !== null) {
        const parsed = Number.parseInt(raw, 10);
        return Number.isNaN(parsed) ? null : parsed;
      }
    }
    current = current.parentNode;
  }
  return null;
}

// Snapshot of one selection endpoint, taken synchronously at mouseup. The
// async getTextContent() round-trip can race a text-layer rebuild (PdfPage's
// useEffect runs on any scale change and calls `replaceChildren()`), which
// would leave the live Range's startContainer/endContainer pointing at
// detached nodes. Snapshotting up-front keeps the resolution path immune.
export type EndpointSnapshot = {
  pageIndex: number | null;
  itemIndex: number | null;
  offset: number;
};

export function snapshotEndpoint(node: Node, offset: number): EndpointSnapshot {
  return {
    pageIndex: pageIndexOf(node),
    itemIndex: findItemIndex(node),
    offset,
  };
}

// Geometric summary of which `[data-item-index]` spans the user's drag visually
// covered on a page. Computed from the spans' client rects against the cursor's
// y interval, NOT from `Range.intersectsNode` — the live Range's DOM coverage
// extends well past the visible selection when the user releases in chrome
// (side gutter, gap between pages), and using it directly is what made the
// "release in margin" gesture capture the rest of the page.
export type PageSnapshot = {
  pageIndex: number;
  firstIntersectedItem: number | null;
  lastIntersectedItem: number | null;
};

// Per-page plan for a contiguous selection. Each entry describes a contiguous
// range of text items on a single page; the caller fetches text items for that
// page and resolves to an Anchor with the clamped offsets.
export type CrossPageEndpoint = {
  pageIndex: number;
  startItem: number;
  startOffset: number;
  endItem: number | "last"; // "last" = to the end of the page's text items
  endOffset: number | "end"; // "end" = to the end of the final item
};

// Build a per-page entry from the two synchronous endpoint snapshots and the
// page's geometric span snapshot. Used for both single-page and multi-page
// selections — the geometric snapshot already encodes whether this page is
// fully covered (interior pages of a cross-page drag) or partially covered.
//
// Endpoint snapshots provide sub-character offsets when they land on the
// boundary span; the geometric snapshot defines the boundary itself, so a
// release in the side gutter caps the captured range at the cursor's line
// instead of running to end-of-page.
export function planPage(
  startEp: EndpointSnapshot,
  endEp: EndpointSnapshot,
  pageSnap: PageSnapshot,
  itemCount: number,
): CrossPageEndpoint | null {
  if (itemCount === 0) return null;
  const { pageIndex, firstIntersectedItem, lastIntersectedItem } = pageSnap;
  if (firstIntersectedItem === null || lastIntersectedItem === null) return null;
  if (firstIntersectedItem > lastIntersectedItem) return null;

  // Order the endpoint snapshots by (itemIndex, offset) so that downstream
  // code can apply head.offset to the start span and tail.offset to the end
  // span, regardless of the order they were passed in. A real Range's
  // startContainer is always DOM-first, but defensive ordering keeps the
  // contract robust to caller mistakes and to backwards-built test fixtures.
  const startResolved = startEp.pageIndex === pageIndex && startEp.itemIndex !== null;
  const endResolved = endEp.pageIndex === pageIndex && endEp.itemIndex !== null;
  let head: EndpointSnapshot | null = null;
  let tail: EndpointSnapshot | null = null;
  if (startResolved && endResolved) {
    const startFirst =
      (startEp.itemIndex as number) < (endEp.itemIndex as number) ||
      ((startEp.itemIndex as number) === (endEp.itemIndex as number) &&
        startEp.offset <= endEp.offset);
    head = startFirst ? startEp : endEp;
    tail = startFirst ? endEp : startEp;
  } else if (startResolved) {
    head = startEp;
  } else if (endResolved) {
    tail = endEp;
  }

  // Trust the endpoint snapshot when it resolved to a span on this page — the
  // geometric band is only authoritative when the endpoint is stray (release
  // in chrome / gutter, text-layer rebuilt mid-flight). Using the band as a
  // hard bound when the endpoint was resolved widens the selection to the
  // full line(s) the cursor passed through, because items on the same line
  // share y-intervals. Clamp to the band so a stray snap can't escape it.
  const startItem =
    head !== null ? Math.max(head.itemIndex as number, firstIntersectedItem) : firstIntersectedItem;
  const startOffset = head !== null && startItem === head.itemIndex ? head.offset : 0;

  const endItem =
    tail !== null ? Math.min(tail.itemIndex as number, lastIntersectedItem) : lastIntersectedItem;
  const endOffset: number | "end" =
    tail !== null && endItem === tail.itemIndex ? tail.offset : "end";

  if (startItem === endItem && typeof endOffset === "number" && startOffset === endOffset) {
    return null;
  }

  return { pageIndex, startItem, startOffset, endItem, endOffset };
}

export function resolveEndpointToAnchor(
  ep: CrossPageEndpoint,
  pageTextItems: ReadonlyArray<TextItem>,
): Anchor | null {
  const bounds = pageTextItems.length;
  if (bounds === 0) return null;

  const startItem = Math.min(ep.startItem, bounds - 1);
  const endItem = ep.endItem === "last" ? bounds - 1 : Math.min(ep.endItem, bounds - 1);
  if (startItem > endItem) return null;

  const startIt = pageTextItems[startItem];
  const endIt = pageTextItems[endItem];
  if (!startIt || !endIt) return null;

  const startOffset = Math.min(ep.startOffset, startIt.str.length);
  const endOffset =
    ep.endOffset === "end" ? endIt.str.length : Math.min(ep.endOffset, endIt.str.length);

  if (startItem === endItem && startOffset === endOffset) return null;

  return {
    pageIndex: ep.pageIndex,
    startItem,
    startOffset,
    endItem,
    endOffset,
  };
}

// Exported for the extract/render layer and the unit tests — both need to
// produce the same normalized `quote` the bundle stores, so the serialized
// value round-trips against the plugin's search without locale-dependent drift.
export function normalizeQuote(raw: string): string {
  return raw.normalize("NFKC").replace(/\s+/g, " ").trim();
}
