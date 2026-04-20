import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { describe, expect, it } from "vitest";
import {
  type EndpointSnapshot,
  normalizeQuote,
  type PageSnapshot,
  planPage,
  resolveEndpointToAnchor,
  snapshotEndpoint,
} from "../anchor";

// Minimal TextItem stub: the fields used by anchor/extract/render are `str`,
// `width`, `height`, `transform`, `hasEOL`. We zero everything except `str`
// and length-derived concerns here; anchor.ts only reads `str.length`.
function ti(str: string, eol = false): TextItem {
  return {
    str,
    dir: "ltr",
    width: str.length,
    height: 1,
    transform: [1, 0, 0, 1, 0, 0],
    fontName: "mock",
    hasEOL: eol,
  };
}

// JSDOM-free mock: build an Element/Node graph by hand so we control data attrs.
type MockNode = {
  nodeType: number;
  parentNode: MockNode | null;
  getAttribute?: (name: string) => string | null;
};

function makeTextNode(parent: MockNode): MockNode {
  return { nodeType: 3, parentNode: parent };
}

function makeSpan(itemIndex: number, pageIndex: number): MockNode {
  const page: MockNode = {
    nodeType: 1,
    parentNode: null,
    getAttribute: (n) => (n === "data-page-index" ? String(pageIndex) : null),
  };
  const span: MockNode = {
    nodeType: 1,
    parentNode: page,
    getAttribute: (n) => (n === "data-item-index" ? String(itemIndex) : null),
  };
  return span;
}

// A node with no data-item-index ancestor (e.g. release in chrome / gutter).
function makeStrayNode(): MockNode {
  return { nodeType: 1, parentNode: null, getAttribute: () => null };
}

function snap(node: MockNode, offset: number): EndpointSnapshot {
  return snapshotEndpoint(node as unknown as Node, offset);
}

function pageSnap(
  pageIndex: number,
  firstIntersectedItem: number | null,
  lastIntersectedItem: number | null,
): PageSnapshot {
  return { pageIndex, firstIntersectedItem, lastIntersectedItem };
}

describe("normalizeQuote", () => {
  it("applies NFKC normalization", () => {
    // U+FB01 (fi ligature) decomposes to "fi" under NFKC.
    expect(normalizeQuote("of\uFB01cial")).toBe("official");
  });

  it("collapses whitespace", () => {
    expect(normalizeQuote("  hello\n\tworld   ")).toBe("hello world");
  });

  it("treats the fi ligature identically to its expansion", () => {
    expect(normalizeQuote("\uFB01nal")).toBe(normalizeQuote("final"));
  });

  it("handles fl ligature", () => {
    expect(normalizeQuote("\uFB02ow")).toBe("flow");
  });
});

describe("planPage + resolveEndpointToAnchor", () => {
  const items = [ti("Hello "), ti("world"), ti(" today")];

  function resolve(
    start: EndpointSnapshot,
    end: EndpointSnapshot,
    snap: PageSnapshot = pageSnap(0, 0, items.length - 1),
  ) {
    const entry = planPage(start, end, snap, items.length);
    if (!entry) return null;
    return resolveEndpointToAnchor(entry, items);
  }

  it("resolves a single-item selection", () => {
    const text = makeTextNode(makeSpan(1, 0));
    expect(resolve(snap(text, 0), snap(text, 5), pageSnap(0, 1, 1))).toEqual({
      pageIndex: 0,
      startItem: 1,
      startOffset: 0,
      endItem: 1,
      endOffset: 5,
    });
  });

  it("resolves a cross-item selection", () => {
    const startNode = makeTextNode(makeSpan(0, 0));
    const endNode = makeTextNode(makeSpan(2, 0));
    expect(resolve(snap(startNode, 2), snap(endNode, 4), pageSnap(0, 0, 2))).toEqual({
      pageIndex: 0,
      startItem: 0,
      startOffset: 2,
      endItem: 2,
      endOffset: 4,
    });
  });

  it("orders reversed snapshots so start precedes end", () => {
    const startNode = makeTextNode(makeSpan(2, 0));
    const endNode = makeTextNode(makeSpan(0, 0));
    const anchor = resolve(snap(startNode, 3), snap(endNode, 1), pageSnap(0, 0, 2));
    expect(anchor?.startItem).toBe(0);
    expect(anchor?.startOffset).toBe(1);
    expect(anchor?.endItem).toBe(2);
    expect(anchor?.endOffset).toBe(3);
  });

  it("handles mid-item to mid-item selections", () => {
    const startNode = makeTextNode(makeSpan(0, 0));
    const endNode = makeTextNode(makeSpan(1, 0));
    expect(resolve(snap(startNode, 2), snap(endNode, 3), pageSnap(0, 0, 1))).toEqual({
      pageIndex: 0,
      startItem: 0,
      startOffset: 2,
      endItem: 1,
      endOffset: 3,
    });
  });

  it("rejects collapsed snapshots on a single-item page snap", () => {
    const text = makeTextNode(makeSpan(0, 0));
    expect(resolve(snap(text, 1), snap(text, 1), pageSnap(0, 0, 0))).toBeNull();
  });

  it("clamps offsets to the text item string length", () => {
    const text = makeTextNode(makeSpan(1, 0));
    const anchor = resolve(snap(text, 0), snap(text, 999), pageSnap(0, 1, 1));
    expect(anchor?.endOffset).toBe(items[1]?.str.length);
  });

  it("drops a page with no intersected spans (cursor band missed all text)", () => {
    const text = makeTextNode(makeSpan(0, 0));
    expect(resolve(snap(text, 0), snap(text, 3), pageSnap(0, null, null))).toBeNull();
  });

  // Side-gutter release. The user dragged from word A on line 1 into the right
  // gutter on line 2. The Range's endContainer points at the gutter element,
  // but the geometric pageSnap caps the captured range at the line the cursor
  // was on. The end span isn't the start-snap's span, so its precise offset
  // is unknown — we capture the full last span via "end".
  it("caps end at the cursor line when the user releases in the side gutter", () => {
    const startNode = makeTextNode(makeSpan(0, 0));
    const stray = makeStrayNode(); // gutter element
    const anchor = resolve(snap(startNode, 0), snap(stray, 0), pageSnap(0, 0, 1));
    expect(anchor).toEqual({
      pageIndex: 0,
      startItem: 0,
      startOffset: 0,
      endItem: 1,
      endOffset: items[1]?.str.length,
    });
  });

  // Symmetric: user dragged in from above the page (start in chrome) and
  // released on a span in the middle of the page. The geometric pageSnap
  // pins the start at the first intersected span on the cursor band, with
  // offset 0.
  it("caps start at the cursor band when the user dragged in from above the page", () => {
    const stray = makeStrayNode();
    const endNode = makeTextNode(makeSpan(1, 0));
    const anchor = resolve(snap(stray, 0), snap(endNode, 4), pageSnap(0, 0, 1));
    expect(anchor).toEqual({
      pageIndex: 0,
      startItem: 0,
      startOffset: 0,
      endItem: 1,
      endOffset: 4,
    });
  });

  // Regression for the original report. Both endpoint snapshots have lost
  // their `data-item-index` (text-layer rebuilt mid-flight), and the
  // geometric pageSnap only intersects spans 0–1. We must capture exactly
  // those, not the whole page.
  it("respects the geometric snap when both endpoints lost their item index", () => {
    const stray1 = makeStrayNode();
    const stray2 = makeStrayNode();
    const anchor = resolve(snap(stray1, 0), snap(stray2, 0), pageSnap(0, 0, 1));
    expect(anchor).toEqual({
      pageIndex: 0,
      startItem: 0,
      startOffset: 0,
      endItem: 1,
      endOffset: items[1]?.str.length,
    });
  });

  // Regression: selecting "Hello world" on a line that also contains " today"
  // used to capture the full line because the geometric band intersected all
  // items on the line and the code pinned endItem to lastIntersectedItem,
  // ignoring the resolved tail endpoint. The endpoint snapshot is the truth
  // when it points inside a span on this page; the band should only narrow
  // stray endpoints.
  it("does not widen past the resolved endpoint when the band spans the whole line", () => {
    const startNode = makeTextNode(makeSpan(0, 0));
    const endNode = makeTextNode(makeSpan(1, 0));
    const anchor = resolve(snap(startNode, 0), snap(endNode, 3), pageSnap(0, 0, 2));
    expect(anchor).toEqual({
      pageIndex: 0,
      startItem: 0,
      startOffset: 0,
      endItem: 1,
      endOffset: 3,
    });
  });

  it("ignores cross-page snapshot offsets when planning a different page", () => {
    // Endpoints land on page 1, but we're planning page 0. Use the geometric
    // snap entirely (page 0 covered fully by the band).
    const startNode = makeTextNode(makeSpan(1, 1));
    const endNode = makeTextNode(makeSpan(2, 1));
    const anchor = resolve(snap(startNode, 0), snap(endNode, 4), pageSnap(0, 0, 2));
    expect(anchor).toEqual({
      pageIndex: 0,
      startItem: 0,
      startOffset: 0,
      endItem: 2,
      endOffset: items[2]?.str.length,
    });
  });
});
