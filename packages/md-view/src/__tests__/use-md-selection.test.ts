import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureMousedownCaret,
  computeMarkdownSelection,
  type NativeSelectionSnapshot,
} from "../use-md-selection";

// Mirrors `highlights.test.ts`: build the DOM imperatively with the same
// data-src-* shape `renderMarkdown` emits.
function block(
  tag: string,
  attrs: Record<string, string>,
  children: ReadonlyArray<Node | string>,
): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) {
    if (typeof c === "string") el.appendChild(document.createTextNode(c));
    else el.appendChild(c);
  }
  return el;
}

function mount(...nodes: HTMLElement[]): HTMLElement {
  const wrapper = document.createElement("div");
  for (const n of nodes) wrapper.appendChild(n);
  document.body.replaceChildren(wrapper);
  return wrapper;
}

function src(line: number, col: number, endLine = line): Record<string, string> {
  return {
    "data-src-file": "doc.md",
    "data-src-line": String(line),
    "data-src-end-line": String(endLine),
    "data-src-col": String(col),
  };
}

function firstText(el: Element): Text {
  const n = el.firstChild;
  if (!n || n.nodeType !== 3) throw new Error("expected first child text node");
  return n as Text;
}

function snapshot(
  anchorNode: Node,
  anchorOffset: number,
  focusNode: Node,
  focusOffset: number,
): NativeSelectionSnapshot {
  return {
    anchorNode,
    anchorOffset,
    focusNode,
    focusOffset,
    isCollapsed: anchorNode === focusNode && anchorOffset === focusOffset,
    rangeCount: 1,
  };
}

describe("captureMousedownCaret", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a text-node caret when caretRangeFromPoint resolves into the container", () => {
    const p = block("p", src(1, 0), ["hello world"]);
    const wrapper = mount(p);
    const text = firstText(p);
    // happy-dom doesn't implement caretRangeFromPoint; install one.
    (document as Document & { caretRangeFromPoint?: unknown }).caretRangeFromPoint = vi
      .fn()
      .mockImplementation(() => {
        const r = document.createRange();
        r.setStart(text, 6);
        r.setEnd(text, 6);
        return r;
      });
    const caret = captureMousedownCaret(wrapper, 10, 10);
    expect(caret).not.toBeNull();
    expect(caret?.node).toBe(text);
    expect(caret?.offset).toBe(6);
  });

  it("rejects an element-node caret (click on padding / list marker)", () => {
    const li = block("li", src(2, 2), ["first item"]);
    const wrapper = mount(block("ul", {}, [li]));
    (document as Document & { caretRangeFromPoint?: unknown }).caretRangeFromPoint = vi
      .fn()
      .mockImplementation(() => {
        const r = document.createRange();
        r.setStart(li, 0);
        r.setEnd(li, 0);
        return r;
      });
    expect(captureMousedownCaret(wrapper, 10, 10)).toBeNull();
  });

  it("returns null when caretRangeFromPoint resolves outside the container", () => {
    const p = block("p", src(1, 0), ["inside"]);
    const wrapper = mount(p);
    const stray = document.createElement("p");
    stray.textContent = "outside";
    document.body.appendChild(stray);
    const strayText = stray.firstChild as Text;
    (document as Document & { caretRangeFromPoint?: unknown }).caretRangeFromPoint = vi
      .fn()
      .mockImplementation(() => {
        const r = document.createRange();
        r.setStart(strayText, 2);
        r.setEnd(strayText, 2);
        return r;
      });
    expect(captureMousedownCaret(wrapper, 10, 10)).toBeNull();
  });
});

describe("computeMarkdownSelection", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("anchors at the click column in a single paragraph (not block start)", () => {
    const p = block("p", src(1, 0), ["hello world"]);
    const wrapper = mount(p);
    const t = firstText(p);
    const result = computeMarkdownSelection(wrapper, null, snapshot(t, 6, t, 11));
    expect(result).not.toBeNull();
    expect(result?.anchor).toEqual({
      kind: "source",
      file: "doc.md",
      lineStart: 1,
      colStart: 6,
      lineEnd: 1,
      colEnd: 11,
    });
    expect(result?.quote).toBe("world");
  });

  it("spans two list items as a two-line anchor", () => {
    const li1 = block("li", src(1, 2), ["first item"]);
    const li2 = block("li", src(2, 2), ["second item"]);
    const ul = block("ul", {}, [li1, li2]);
    const wrapper = mount(ul);
    const t1 = firstText(li1);
    const t2 = firstText(li2);
    const result = computeMarkdownSelection(wrapper, null, snapshot(t1, 6, t2, 6));
    expect(result).not.toBeNull();
    expect(result?.anchor.lineStart).toBe(1);
    expect(result?.anchor.lineEnd).toBe(2);
    expect(result?.quote).toContain("item");
    expect(result?.quote).toContain("second");
  });

  it("defers to the mousedown caret inside a <td> when the native anchor is cell-snapped", () => {
    const td = block("td", src(3, 2), ["cell text"]);
    const tr = block("tr", {}, [td]);
    const tbody = block("tbody", {}, [tr]);
    const table = block("table", {}, [tbody]);
    const wrapper = mount(table);
    const text = firstText(td);
    // Simulate WebKit cell-snap: native anchor points at the <td> element at
    // offset 0 (top of the cell), focus is the drag-end inside text.
    const sel = snapshot(td, 0, text, 9);
    (document as Document & { caretRangeFromPoint?: unknown }).caretRangeFromPoint = vi
      .fn()
      .mockImplementation(() => {
        const r = document.createRange();
        r.setStart(text, 5);
        r.setEnd(text, 5);
        return r;
      });
    const mousedown = { x: 42, y: 42 };
    const result = computeMarkdownSelection(wrapper, mousedown, sel);
    expect(result).not.toBeNull();
    // Without the mousedown override we'd get colStart = td col (2) via the
    // block start. With the override the anchor reflects the click: 2 + 5 = 7.
    expect(result?.anchor.colStart).toBe(7);
  });

  it("ignores a stale mousedown in a different text node (keyboard-driven selection)", () => {
    // Mousedown from an earlier click in paragraph 1, then a Shift+Arrow
    // selection lands the browser's native anchor in paragraph 2. Because
    // the native anchor's text node differs from the re-resolved mousedown
    // caret's text node, we trust the native anchor — preserving
    // keyboard-driven gestures.
    const p1 = block("p", src(1, 0), ["first paragraph"]);
    const p2 = block("p", src(3, 0), ["second paragraph"]);
    const wrapper = mount(p1, p2);
    const t1 = firstText(p1);
    const t2 = firstText(p2);
    (document as Document & { caretRangeFromPoint?: unknown }).caretRangeFromPoint = vi
      .fn()
      .mockImplementation(() => {
        const r = document.createRange();
        r.setStart(t1, 4);
        r.setEnd(t1, 4);
        return r;
      });
    const stale = { x: 10, y: 10 }; // click-coords from the earlier click in p1
    const result = computeMarkdownSelection(wrapper, stale, snapshot(t2, 7, t2, 16));
    expect(result?.anchor.lineStart).toBe(3);
    expect(result?.anchor.colStart).toBe(7);
    expect(result?.anchor.colEnd).toBe(16);
    expect(result?.quote).toBe("paragraph");
  });

  it("defers to mousedown when WebKit collapses the native offset to 0 of the same text node", () => {
    // Observed WebKit mode 2: the drag extends past an inline boundary and
    // the native `sel.anchorOffset` collapses to 0 of the block's first
    // text node, even though the user clicked mid-block. The re-resolved
    // mousedown caret is in the same text node at the exact click pixel,
    // so we should prefer it whenever `anchorNode === freshCaret.node`.
    const h = block("h2", src(7, 0), ["What we are building"]);
    const wrapper = mount(h);
    const t = firstText(h);
    (document as Document & { caretRangeFromPoint?: unknown }).caretRangeFromPoint = vi
      .fn()
      .mockImplementation(() => {
        const r = document.createRange();
        r.setStart(t, 8); // start of "are"
        r.setEnd(t, 8);
        return r;
      });
    const mousedown = { x: 80, y: 10 };
    const snapped = snapshot(t, 0, t, 20); // WebKit collapsed to [0], focus at end
    const result = computeMarkdownSelection(wrapper, mousedown, snapped);
    expect(result).not.toBeNull();
    expect(result?.anchor.colStart).toBe(8);
    expect(result?.anchor.colEnd).toBe(20);
    expect(result?.quote).toBe("are building");
  });

  it("defers to mousedown caret when WebKit snaps the anchor to a container element mid-drag", () => {
    // Observed in Tauri's WKWebView: after the drag crosses an inline
    // boundary, `sel.anchorNode` jumps from the text node to the outer
    // `.md-view` container at some child index. `normalizeEndpoint` would
    // pin that to the first text node's offset 0 — i.e. block start — so
    // we prefer the mousedown caret whenever the native anchor is not a
    // text node.
    const p1 = block("p", src(1, 0), ["first paragraph"]);
    const p2 = block("p", src(3, 0), ["Everything else — investor pitch, blog"]);
    const mdView = document.createElement("div");
    mdView.className = "md-view";
    mdView.appendChild(p1);
    mdView.appendChild(p2);
    document.body.replaceChildren(mdView);
    const p2Text = firstText(p2);
    (document as Document & { caretRangeFromPoint?: unknown }).caretRangeFromPoint = vi
      .fn()
      .mockImplementation(() => {
        const r = document.createRange();
        r.setStart(p2Text, 18); // start of "investor"
        r.setEnd(p2Text, 18);
        return r;
      });
    const mousedown = { x: 100, y: 50 };
    const snapped = snapshot(mdView, 1, p2Text, 38); // native anchor jumped to mdView[1]
    const result = computeMarkdownSelection(mdView, mousedown, snapped);
    expect(result).not.toBeNull();
    expect(result?.anchor.colStart).toBe(18);
    expect(result?.anchor.colEnd).toBe(38);
    expect(result?.quote).toBe("investor pitch, blog");
  });

  it("produces a valid anchor for selections with no cached mousedown (keyboard select-all)", () => {
    const p = block("p", src(9, 0), ["paragraph text"]);
    const wrapper = mount(p);
    const t = firstText(p);
    const result = computeMarkdownSelection(wrapper, null, snapshot(t, 0, t, 14));
    expect(result).not.toBeNull();
    expect(result?.anchor.colStart).toBe(0);
    expect(result?.anchor.colEnd).toBe(14);
    expect(result?.quote).toBe("paragraph text");
  });

  it("returns null when the selection is collapsed", () => {
    const p = block("p", src(1, 0), ["hello"]);
    const wrapper = mount(p);
    const t = firstText(p);
    const collapsed: NativeSelectionSnapshot = {
      anchorNode: t,
      anchorOffset: 2,
      focusNode: t,
      focusOffset: 2,
      isCollapsed: true,
      rangeCount: 1,
    };
    expect(computeMarkdownSelection(wrapper, null, collapsed)).toBeNull();
  });

  it("returns null when either endpoint sits outside the container", () => {
    const p = block("p", src(1, 0), ["inside"]);
    const wrapper = mount(p);
    const t = firstText(p);
    const stray = document.createElement("p");
    stray.textContent = "stray";
    document.body.appendChild(stray);
    const strayText = stray.firstChild as Text;
    const result = computeMarkdownSelection(wrapper, null, snapshot(t, 0, strayText, 5));
    expect(result).toBeNull();
  });
});
