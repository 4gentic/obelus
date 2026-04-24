import { beforeEach, describe, expect, it } from "vitest";
import { resolveSourceAnchorToRange, textNodeAtOffset } from "../highlights";

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
    });
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
    });
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
    });
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
    });
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
    });
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
    });
    expect(range).not.toBeNull();
  });
});
