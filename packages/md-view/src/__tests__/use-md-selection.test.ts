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

  it("refines colStart past a list marker + bold delimiter when text is supplied", () => {
    // Source: `- **Built + tested** rest`. The <li>'s data-src-col is 0
    // (source col of the `-`), but the rendered <strong> text starts at
    // source col 4 ("B"). Without refinement, endpointToCoord returns
    // col=0+0=0 and sliceSourceSpan emits the leading `- **` as part of the
    // quote. With refinement we find "Built + tested" in the mdast-walked
    // view and re-anchor at source col 4.
    const source = "- **Built + tested** rest";
    const strong = block("strong", {}, ["Built + tested"]);
    const li = block("li", src(1, 0, 1), [strong, document.createTextNode(" rest")]);
    const wrapper = mount(block("ul", {}, [li]));
    const strongText = firstText(strong);
    const result = computeMarkdownSelection(
      wrapper,
      null,
      snapshot(strongText, 0, strongText, 14),
      source,
    );
    expect(result).not.toBeNull();
    expect(result?.anchor.lineStart).toBe(1);
    expect(result?.anchor.colStart).toBe(4);
    expect(result?.anchor.colEnd).toBe(18);
    expect(result?.quote).toBe("Built + tested");
    expect(result?.quote.startsWith("- **")).toBe(false);
  });

  it("keeps source delimiters between endpoints when selection spans a closing `**`", () => {
    // Source: `**bold** tail`. Select from "b" of bold through "l" of tail.
    // The rendered run is "bold tail" (9 chars); the source slice must carry
    // the intervening `**` so plan-fix's verifier (NFKC + whitespace-collapse
    // `.includes()` against source) still matches.
    const source = "**bold** tail";
    const strong = block("strong", {}, ["bold"]);
    const p = block("p", src(1, 0, 1), [strong, document.createTextNode(" tail")]);
    const wrapper = mount(p);
    const strongText = firstText(strong);
    const tailText = p.childNodes[1] as Text;
    const result = computeMarkdownSelection(
      wrapper,
      null,
      snapshot(strongText, 0, tailText, 5),
      source,
    );
    expect(result).not.toBeNull();
    expect(result?.anchor.colStart).toBe(2);
    expect(result?.anchor.colEnd).toBe(13);
    expect(result?.quote).toBe("bold** tail");
  });

  it("anchors a selection inside inline code past the opening backtick", () => {
    // Source: `` a `foo` b ``. `inlineCode`'s mdast position starts at the
    // opening backtick; we advance by the backtick run so the rendered "foo"
    // maps to source col 3 (0-indexed) — not col 2.
    const source = "a `foo` b";
    const code = block("code", {}, ["foo"]);
    const p = block("p", src(1, 0, 1), [
      document.createTextNode("a "),
      code,
      document.createTextNode(" b"),
    ]);
    const wrapper = mount(p);
    const codeText = firstText(code);
    const result = computeMarkdownSelection(
      wrapper,
      null,
      snapshot(codeText, 0, codeText, 3),
      source,
    );
    expect(result).not.toBeNull();
    expect(result?.anchor.colStart).toBe(3);
    expect(result?.anchor.colEnd).toBe(6);
    expect(result?.quote).toBe("foo");
  });

  it("anchors a selection inside a [link text](url) to the bracketed text only", () => {
    // Source: `[link text](http://e.com)`. Rendered is "link text"; the
    // source slice should span only the text, not the URL part.
    const source = "[link text](http://e.com)";
    const a = block("a", { href: "http://e.com" }, ["link text"]);
    const p = block("p", src(1, 0, 1), [a]);
    const wrapper = mount(p);
    const linkText = firstText(a);
    const result = computeMarkdownSelection(
      wrapper,
      null,
      snapshot(linkText, 0, linkText, 9),
      source,
    );
    expect(result).not.toBeNull();
    expect(result?.anchor.colStart).toBe(1);
    expect(result?.anchor.colEnd).toBe(10);
    expect(result?.quote).toBe("link text");
  });

  it("falls back to the existing slicing path when the rendered quote isn't in the source", () => {
    // Source intentionally out of sync with the DOM (e.g. buffer mid-edit).
    // Refinement can't locate the rendered text, so we must not throw or
    // return null — the old anchor+slice path is strictly no worse than
    // today, which is the property the plan guards.
    const source = "totally unrelated source text";
    const p = block("p", src(1, 0, 1), ["hello world"]);
    const wrapper = mount(p);
    const t = firstText(p);
    const result = computeMarkdownSelection(wrapper, null, snapshot(t, 0, t, 5), source);
    expect(result).not.toBeNull();
    // Fallback uses the initial anchor's cols; colStart is 0 (block start)
    // and sliceSourceSpan returns whatever source.slice(0, 5) is. The
    // important invariant is non-null — the user's selection isn't dropped.
    expect(result?.quote.length).toBeGreaterThan(0);
  });

  it("uses live pointer to resolve focus when WebKit snaps focus to a container element", () => {
    // Observed: drag from inside a <strong> inside a <li>, focus is WebKit-
    // snapped to the <li> element at a high child index. Without the pointer
    // fallback, `normalizeEndpoint` descends to the <li>'s last text child
    // and the anchor would span the entire bullet. With the pointer, we land
    // on a text-node caret roughly where the user's cursor is.
    const strong = block("strong", src(5, 2), ["Built"]);
    const trailingCode = block("code", src(5, 20), ["fast-check"]);
    const li = document.createElement("li");
    li.setAttribute("data-src-file", "doc.md");
    li.setAttribute("data-src-line", "5");
    li.setAttribute("data-src-end-line", "5");
    li.setAttribute("data-src-col", "0");
    li.appendChild(strong);
    li.appendChild(document.createTextNode(" + tested "));
    li.appendChild(trailingCode);
    li.appendChild(document.createTextNode(" tail text at end of line"));
    const wrapper = mount(block("ul", {}, [li]));
    const strongText = firstText(strong);

    (document as Document & { caretRangeFromPoint?: unknown }).caretRangeFromPoint = vi
      .fn()
      .mockImplementation((x: number, _y: number) => {
        const r = document.createRange();
        // Pointer lands on the " + tested " text node at offset 5 ("+ tes|ted")
        // — strictly inside the bullet, before the trailing code span.
        if (x === 200) {
          const tested = li.childNodes[1] as Text;
          r.setStart(tested, 5);
          r.setEnd(tested, 5);
          return r;
        }
        return null;
      });

    const snapped: NativeSelectionSnapshot = {
      anchorNode: strongText,
      anchorOffset: 0,
      focusNode: li,
      focusOffset: 4, // WebKit points at a child index deep into the <li>
      isCollapsed: false,
      rangeCount: 1,
    };
    const result = computeMarkdownSelection(wrapper, null, snapped, undefined, { x: 200, y: 10 });
    expect(result).not.toBeNull();
    // Focus should land at the pointer-resolved caret, not the block's last
    // text child. The selection does NOT span to the end of the bullet.
    expect(result?.anchor.lineStart).toBe(5);
    expect(result?.anchor.lineEnd).toBe(5);
    // colEnd reflects the pointer-resolved caret inside " + tested ", which
    // is within the bullet but well before the trailing tail text.
    expect(result?.anchor.colEnd).toBeLessThan(30);
  });
});
