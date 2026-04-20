// Why getBoundingClientRect appears in this file despite the compositor charter:
// the charter bans it for STORED highlight rects — those must use transform
// matrices because getBoundingClientRect drifts under CSS zoom. The helpers
// below (pagesForBand, fallbackFromPoint, snapshotPage) use it only for live
// MOUSE-gesture geometry, resolving cursor coords to text items before any
// anchor exists. The resulting anchors are then rebuilt via transform-matrix
// rects in packages/anchor for storage.

import {
  type Anchor,
  type EndpointSnapshot,
  normalizeQuote,
  type PageSnapshot,
  planPage,
  resolveEndpointToAnchor,
  snapshotEndpoint,
} from "@obelus/anchor";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextItem, TextMarkedContent } from "pdfjs-dist/types/src/display/api";
import type { JSX } from "react";
import { type ReactNode, useEffect, useRef } from "react";

type Props = {
  doc: PDFDocumentProxy;
  onAnchor: (
    anchors: Anchor[],
    quote: string,
    itemsByPage: ReadonlyMap<number, ReadonlyArray<TextItem>>,
  ) => void;
  children: ReactNode;
};

// Must match pdfjs TextLayer's own filter: only non-empty-string TextItems
// get a rendered span. If we include empty-str items here, our list indices
// drift relative to DOM `data-item-index` and sub-line selections resolve
// against the wrong item.
function isTextItem(x: TextItem | TextMarkedContent): x is TextItem {
  return "str" in x && x.str !== "";
}

function makePageItemCache(doc: PDFDocumentProxy): (pageIndex: number) => Promise<TextItem[]> {
  const cache = new Map<number, Promise<TextItem[]>>();
  return (pageIndex) => {
    const hit = cache.get(pageIndex);
    if (hit) return hit;
    const fetch = doc.getPage(pageIndex + 1).then(async (page) => {
      const content = await page.getTextContent();
      return content.items.filter(isTextItem);
    });
    cache.set(pageIndex, fetch);
    return fetch;
  };
}

// Pages whose visual rect overlaps the cursor band, plus the pages each
// snapshot endpoint landed on (catches single-line selections inside one page
// where downY === upY but the snapshot endpoints landed unambiguously). Using
// visual overlap rather than `Range.intersectsNode` keeps a release-in-margin
// from sweeping in pages the user dragged DOM-past via chrome.
function pagesForBand(
  topY: number,
  bottomY: number,
  endpointPages: ReadonlyArray<number>,
  host: HTMLElement,
): { el: HTMLElement; index: number }[] {
  const collected = new Map<number, HTMLElement>();
  for (const el of host.querySelectorAll<HTMLElement>("[data-page-index]")) {
    const raw = el.getAttribute("data-page-index");
    if (!raw) continue;
    const idx = Number.parseInt(raw, 10);
    if (Number.isNaN(idx)) continue;
    const r = el.getBoundingClientRect();
    const overlapsBand = !(r.bottom < topY || r.top > bottomY);
    if (overlapsBand || endpointPages.includes(idx)) collected.set(idx, el);
  }
  return Array.from(collected.entries())
    .sort(([a], [b]) => a - b)
    .map(([index, el]) => ({ index, el }));
}

// Geometric fallback for an endpoint whose Range container lost its
// `data-item-index`. Happens when the user releases between sibling spans —
// pdfjs positions spans absolutely with small kerning gaps, so a release in
// the gap between (e.g.) "introduce" and an italic "Negotiated" lands on the
// text-layer container, not on either span. Without this, `planPage` falls
// back to the y-band's last intersected item and widens the selection to the
// end of the visual line.
function fallbackFromPoint(host: HTMLElement, x: number, y: number): EndpointSnapshot | null {
  let pageEl: HTMLElement | null = null;
  let pageIndex: number | null = null;
  for (const el of host.querySelectorAll<HTMLElement>("[data-page-index]")) {
    const r = el.getBoundingClientRect();
    if (y < r.top || y > r.bottom) continue;
    const raw = el.getAttribute("data-page-index");
    if (!raw) continue;
    const idx = Number.parseInt(raw, 10);
    if (Number.isNaN(idx)) continue;
    pageEl = el;
    pageIndex = idx;
    break;
  }
  if (!pageEl || pageIndex === null) return null;

  let nearest: { idx: number; dx: number; rect: DOMRect; len: number } | null = null;
  for (const span of pageEl.querySelectorAll<HTMLElement>("span[data-item-index]")) {
    const rect = span.getBoundingClientRect();
    if (y < rect.top || y > rect.bottom) continue;
    const raw = span.getAttribute("data-item-index");
    if (!raw) continue;
    const idx = Number.parseInt(raw, 10);
    if (Number.isNaN(idx)) continue;
    const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
    if (nearest === null || dx < nearest.dx) {
      const first = span.firstChild;
      const len = first && first.nodeType === Node.TEXT_NODE ? (first as Text).data.length : 0;
      nearest = { idx, dx, rect, len };
    }
  }
  if (!nearest) return null;

  const { rect, len } = nearest;
  let offset = 0;
  if (len > 0 && rect.width > 0) {
    const clampedX = Math.max(rect.left, Math.min(rect.right, x));
    offset = Math.round(((clampedX - rect.left) / rect.width) * len);
    if (offset < 0) offset = 0;
    if (offset > len) offset = len;
  }
  return { pageIndex, itemIndex: nearest.idx, offset };
}

// First/last `data-item-index` spans on this page whose vertical interval
// intersects the cursor band. Synchronous so the spans can't be torn out by a
// text-layer rebuild before we read them.
function snapshotPage(
  pageEl: HTMLElement,
  pageIndex: number,
  topY: number,
  bottomY: number,
): PageSnapshot {
  let first: number | null = null;
  let last: number | null = null;
  for (const span of pageEl.querySelectorAll<HTMLElement>("span[data-item-index]")) {
    const r = span.getBoundingClientRect();
    if (r.bottom < topY || r.top > bottomY) continue;
    const raw = span.getAttribute("data-item-index");
    if (!raw) continue;
    const idx = Number.parseInt(raw, 10);
    if (Number.isNaN(idx)) continue;
    if (first === null || idx < first) first = idx;
    if (last === null || idx > last) last = idx;
  }
  return { pageIndex, firstIntersectedItem: first, lastIntersectedItem: last };
}

export default function SelectionListener({ doc, onAnchor, children }: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const getItemsRef = useRef(makePageItemCache(doc));

  useEffect(() => {
    getItemsRef.current = makePageItemCache(doc);
  }, [doc]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Only treat mouseup as a selection if the gesture *started* inside the PDF
    // host. Otherwise clicking UI in the review pane (e.g., Discard) while an
    // earlier text selection is still live fires this handler and asynchronously
    // re-creates the draft the click just cleared.
    let started = false;
    let downX = 0;
    let downY = 0;
    const onDown = (ev: MouseEvent): void => {
      started = ev.target instanceof Node && host.contains(ev.target);
      if (started) {
        downX = ev.clientX;
        downY = ev.clientY;
      }
    };

    // Listen at the document level so we still get the event even if the user
    // releases the mouse outside the PDF column (e.g., over the Marks pane).
    const handler = (ev: MouseEvent): void => {
      if (!started) return;
      started = false;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);

      // Snapshot endpoints SYNCHRONOUSLY before any await — see EndpointSnapshot.
      // Prefer the mouse drag's geometric endpoints over the DOM Range. Browsers
      // misplace Range boundaries in absolutely-positioned text layers: clicking
      // inside a visual line can pin Range.start at the start of a much earlier
      // span, so the selection silently extends well past the user's drag. The
      // mouse coords describe exactly what the user swept. For no-movement
      // gestures (double-click word select), fall back to the DOM Range so we
      // preserve the browser's word expansion.
      const startRaw = snapshotEndpoint(range.startContainer, range.startOffset);
      const endRaw = snapshotEndpoint(range.endContainer, range.endOffset);
      const didDrag = Math.abs(ev.clientX - downX) > 2 || Math.abs(ev.clientY - downY) > 2;
      const startEp = didDrag ? (fallbackFromPoint(host, downX, downY) ?? startRaw) : startRaw;
      const endEp = didDrag ? (fallbackFromPoint(host, ev.clientX, ev.clientY) ?? endRaw) : endRaw;

      const topY = Math.min(downY, ev.clientY);
      const bottomY = Math.max(downY, ev.clientY);
      const endpointPages: number[] = [];
      if (startEp.pageIndex !== null) endpointPages.push(startEp.pageIndex);
      if (endEp.pageIndex !== null && endEp.pageIndex !== startEp.pageIndex) {
        endpointPages.push(endEp.pageIndex);
      }
      const pages = pagesForBand(topY, bottomY, endpointPages, host);
      if (pages.length === 0) return;

      // Take the geometric snapshots up front — once we await `getTextContent`,
      // a re-render may move the spans.
      const planned = pages
        .map(({ el, index }) => snapshotPage(el, index, topY, bottomY))
        .filter((s) => s.firstIntersectedItem !== null && s.lastIntersectedItem !== null);
      if (planned.length === 0) return;

      const quote = normalizeQuote(sel.toString());

      void Promise.all(
        planned.map(async (snap) => {
          const items = await getItemsRef.current(snap.pageIndex);
          const entry = planPage(startEp, endEp, snap, items.length);
          if (!entry) return null;
          const anchor = resolveEndpointToAnchor(entry, items);
          if (!anchor) return null;
          return { anchor, items };
        }),
      ).then((entries) => {
        const resolved = entries.filter(
          (x): x is { anchor: Anchor; items: TextItem[] } => x !== null,
        );
        if (resolved.length === 0) return;
        // Pass the items map alongside anchors so the consumer extracts text
        // and computes rects from the exact items the indices were derived
        // from. A separate getTextContent() call could otherwise re-stream
        // with different sequencing, leaving the anchor indices pointing at
        // different items than the user actually selected.
        const itemsByPage = new Map<number, ReadonlyArray<TextItem>>();
        for (const { anchor, items } of resolved) itemsByPage.set(anchor.pageIndex, items);
        onAnchor(
          resolved.map(({ anchor }) => anchor),
          quote,
          itemsByPage,
        );
        window.getSelection()?.removeAllRanges();
      });
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("mouseup", handler);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("mouseup", handler);
    };
  }, [onAnchor]);

  return (
    <div ref={hostRef} className="selection-listener">
      {children}
    </div>
  );
}
