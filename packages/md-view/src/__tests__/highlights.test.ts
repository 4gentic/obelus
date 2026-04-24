import { renderMarkdown } from "@obelus/source-render/browser";
import { beforeEach, describe, expect, it } from "vitest";
import { resolveSourceAnchorToRange, textNodeAtOffset } from "../highlights";
import { buildDocumentSourceMap } from "../source-map";

// Constructs the DOM imperatively so test fixtures are explicit about what
// they build. Matches the attribute shape that `renderMarkdown` emits.
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

const fullLine = (fileLine: number, endLine: number, col: number): Record<string, string> => ({
  "data-src-file": "x.md",
  "data-src-line": String(fileLine),
  "data-src-end-line": String(endLine),
  "data-src-col": String(col),
});

describe("textNodeAtOffset", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("returns the text node and offset for a simple paragraph", () => {
    const p = block("p", fullLine(1, 1, 0), ["hello world"]);
    mount(p);
    const found = textNodeAtOffset(p, 6);
    expect(found).not.toBeNull();
    expect(found?.node.data).toBe("hello world");
    expect(found?.offset).toBe(6);
  });

  it("walks nested inline elements across multiple text nodes", () => {
    const em = block("em", {}, ["brave"]);
    const p = block("p", fullLine(1, 1, 0), ["hello ", em, " world"]);
    mount(p);
    // "hello " (6) + "brave" (5) => offset 9 lands inside <em>brave</em> at index 3 ("v")
    const found = textNodeAtOffset(p, 9);
    expect(found?.node.data).toBe("brave");
    expect(found?.offset).toBe(3);
  });

  it("clamps to the end of the last text node when the offset overruns", () => {
    const p = block("p", fullLine(1, 1, 0), ["short"]);
    mount(p);
    const found = textNodeAtOffset(p, 999);
    expect(found?.node.data).toBe("short");
    expect(found?.offset).toBe(5);
  });

  it("rejects negative offsets", () => {
    const p = block("p", fullLine(1, 1, 0), ["short"]);
    mount(p);
    expect(textNodeAtOffset(p, -1)).toBeNull();
  });
});

describe("resolveSourceAnchorToRange", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("resolves a single-line in-block anchor to a Range", () => {
    const p = block("p", fullLine(1, 1, 0), ["hello world"]);
    const wrapper = mount(p);
    const range = resolveSourceAnchorToRange(wrapper, {
      file: "x.md",
      lineStart: 1,
      colStart: 0,
      lineEnd: 1,
      colEnd: 5,
    }, null, null);
    expect(range).not.toBeNull();
    expect(range?.toString()).toBe("hello");
  });

  it("honours data-src-col offsets to translate source columns into in-block offsets", () => {
    // A blockquote source: `> hello`. Renderer strips the `> ` prefix but
    // stamps data-src-col="2" so source-column math still aligns.
    const p = block("p", fullLine(1, 1, 2), ["hello"]);
    const wrapper = mount(p);
    const range = resolveSourceAnchorToRange(wrapper, {
      file: "x.md",
      lineStart: 1,
      colStart: 2,
      lineEnd: 1,
      colEnd: 7,
    }, null, null);
    expect(range?.toString()).toBe("hello");
  });

  it("accepts a multi-line anchor that straddles two blocks", () => {
    const p1 = block("p", fullLine(1, 1, 0), ["alpha"]);
    const p2 = block("p", fullLine(3, 3, 0), ["beta"]);
    const wrapper = mount(p1, p2);
    const range = resolveSourceAnchorToRange(wrapper, {
      file: "x.md",
      lineStart: 1,
      colStart: 0,
      lineEnd: 3,
      colEnd: 4,
    }, null, null);
    expect(range).not.toBeNull();
    const text = range?.toString() ?? "";
    expect(text).toContain("alpha");
    expect(text).toContain("beta");
  });

  it("returns null when the anchor's file doesn't match any block", () => {
    const p = block("p", { ...fullLine(1, 1, 0), "data-src-file": "other.md" }, ["hello"]);
    const wrapper = mount(p);
    const range = resolveSourceAnchorToRange(wrapper, {
      file: "x.md",
      lineStart: 1,
      colStart: 0,
      lineEnd: 1,
      colEnd: 5,
    }, null, null);
    expect(range).toBeNull();
  });

  it("returns null when the anchor's line range falls outside all blocks", () => {
    const p = block("p", fullLine(1, 1, 0), ["hello"]);
    const wrapper = mount(p);
    const range = resolveSourceAnchorToRange(wrapper, {
      file: "x.md",
      lineStart: 5,
      colStart: 0,
      lineEnd: 5,
      colEnd: 5,
    }, null, null);
    expect(range).toBeNull();
  });

  it("lands inside a multi-line code fence block when the anchor sits mid-block", () => {
    const code = block("code", {}, ["line1\nline2\nline3"]);
    const pre = block("pre", fullLine(1, 5, 0), [code]);
    const wrapper = mount(pre);
    const range = resolveSourceAnchorToRange(wrapper, {
      file: "x.md",
      lineStart: 2,
      colStart: 0,
      lineEnd: 4,
      colEnd: 5,
    }, null, null);
    expect(range).not.toBeNull();
  });
});

// Renders real markdown via `renderMarkdown` and resolves a known-good anchor
// against it. This is the path the desktop and web apps actually exercise:
// the saved anchor's cols are source-byte-accurate (selection-side fix), so
// the resolver must translate them through the same mdast offset map to land
// on the right DOM range. Without the map, naive `colStart - blockSrcCol`
// arithmetic walks past the rendered chars by 2 (`**`) per inline boundary
// crossed and the highlight rectangles drift onto unrelated words.
describe("resolveSourceAnchorToRange (mdast map path)", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  function renderInto(text: string): {
    wrapper: HTMLElement;
    sourceMap: ReturnType<typeof buildDocumentSourceMap>;
  } {
    const result = renderMarkdown({ file: "doc.md", text });
    if (!result.ok) throw new Error(`renderMarkdown failed: ${result.error.kind}`);
    // Parse the rendered HTML through DOMParser instead of innerHTML so the
    // PreToolUse innerHTML guard stays clean (the bytes are local-only test
    // fixtures, but the rule applies project-wide).
    const parsed = new DOMParser().parseFromString(`<div>${result.html}</div>`, "text/html");
    const root = parsed.body.firstElementChild;
    if (!root) throw new Error("DOMParser returned no root");
    const wrapper = document.importNode(root, true) as HTMLElement;
    document.body.replaceChildren(wrapper);
    const sourceMap = buildDocumentSourceMap(text);
    return { wrapper, sourceMap };
  }

  it("paints a bullet's bold prefix without picking up the leading list marker", () => {
    const text = "- **Built + tested** rest";
    const { wrapper, sourceMap } = renderInto(text);
    // Refined anchor (what the selection-side fix produces): "Built + tested"
    // lives at source cols 4..18 on line 1.
    const range = resolveSourceAnchorToRange(
      wrapper,
      { file: "doc.md", lineStart: 1, colStart: 4, lineEnd: 1, colEnd: 18 },
      sourceMap,
      text,
    );
    expect(range).not.toBeNull();
    expect(range?.toString()).toBe("Built + tested");
  });

  it("paints a span that crosses a closing inline delimiter", () => {
    const text = "**bold** tail";
    const { wrapper, sourceMap } = renderInto(text);
    // Refined anchor for selecting from "b" of bold through "l" of tail:
    // colStart=2 (inside `**…**`), colEnd=13 (end of "tail").
    const range = resolveSourceAnchorToRange(
      wrapper,
      { file: "doc.md", lineStart: 1, colStart: 2, lineEnd: 1, colEnd: 13 },
      sourceMap,
      text,
    );
    expect(range).not.toBeNull();
    // Range sees the rendered text — the `**` closing delim contributes no
    // characters, so toString() yields the visually selected span.
    expect(range?.toString()).toBe("bold tail");
  });

  it("paints a span inside an inline code element with no off-by-backtick", () => {
    const text = "a `foo` b";
    const { wrapper, sourceMap } = renderInto(text);
    // Source cols 3..6 = "foo" (after the opening backtick).
    const range = resolveSourceAnchorToRange(
      wrapper,
      { file: "doc.md", lineStart: 1, colStart: 3, lineEnd: 1, colEnd: 6 },
      sourceMap,
      text,
    );
    expect(range?.toString()).toBe("foo");
  });

  it("paints a link's text only, not the URL portion", () => {
    const text = "[link text](http://e.com)";
    const { wrapper, sourceMap } = renderInto(text);
    const range = resolveSourceAnchorToRange(
      wrapper,
      { file: "doc.md", lineStart: 1, colStart: 1, lineEnd: 1, colEnd: 10 },
      sourceMap,
      text,
    );
    expect(range?.toString()).toBe("link text");
  });

  it("paints a span in a paragraph that sits after a fenced code block", () => {
    // Regression for the ROADMAP.md shape: an ASCII-diagram code block
    // precedes the target paragraph. Before the `code` branch in
    // `buildDocumentSourceMap`, the map's rendered string skipped the
    // block's text while the DOM walker still consumed it, so painting
    // the paragraph landed a rect inside the code block.
    const text = "# Heading\n\n```\nrow one\nrow two\n```\n\nAfter text here.\n";
    const { wrapper, sourceMap } = renderInto(text);
    const range = resolveSourceAnchorToRange(
      wrapper,
      { file: "doc.md", lineStart: 8, colStart: 0, lineEnd: 8, colEnd: 10 },
      sourceMap,
      text,
    );
    expect(range?.toString()).toBe("After text");
  });

  it("paints a span inside a fenced code block", () => {
    const text = "```\nalpha\nbeta\n```\n";
    const { wrapper, sourceMap } = renderInto(text);
    const range = resolveSourceAnchorToRange(
      wrapper,
      { file: "doc.md", lineStart: 2, colStart: 0, lineEnd: 2, colEnd: 5 },
      sourceMap,
      text,
    );
    expect(range?.toString()).toBe("alpha");
  });

  it("falls back to the legacy block-local path when sourceMap is null", () => {
    // The legacy path produces wrong rects for inline-bordered selections
    // (that's the bug we're fixing) but must keep working for plain blocks
    // so callers that have no source text — tests, transitional adapters —
    // don't break.
    const p = block("p", fullLine(1, 1, 0), ["hello world"]);
    const wrapper = mount(p);
    const range = resolveSourceAnchorToRange(
      wrapper,
      { file: "x.md", lineStart: 1, colStart: 0, lineEnd: 1, colEnd: 5 },
      null,
      null,
    );
    expect(range?.toString()).toBe("hello");
  });
});
