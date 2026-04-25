import { beforeEach, describe, expect, it } from "vitest";
import { computeHtmlSelectionAnchor } from "../use-html-selection";

function mountTagged(file: string, ...children: HTMLElement[]): HTMLElement {
  const root = document.createElement("div");
  root.setAttribute("data-html-file", file);
  for (const c of children) root.appendChild(c);
  document.body.replaceChildren(root);
  return root;
}

function el(
  tag: string,
  attrs: Record<string, string>,
  children: ReadonlyArray<Node | string>,
): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) {
    if (typeof c === "string") node.appendChild(document.createTextNode(c));
    else node.appendChild(c);
  }
  return node;
}

function selectRange(start: Node, startOffset: number, end: Node, endOffset: number): Selection {
  const range = document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);
  const sel = document.getSelection();
  if (!sel) throw new Error("no document selection");
  sel.removeAllRanges();
  sel.addRange(range);
  return sel;
}

describe("computeHtmlSelectionAnchor", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    document.getSelection()?.removeAllRanges();
  });

  it("returns null when the selection is collapsed", () => {
    const p = el("p", {}, ["hello"]);
    const mount = mountTagged("paper.html", p);
    const text = p.firstChild as Text;
    const sel = selectRange(text, 2, text, 2);
    const result = computeHtmlSelectionAnchor(mount, sel, "html", undefined);
    expect(result).toBeNull();
  });

  it("returns null when the selection sits outside the mount", () => {
    const inside = el("p", {}, ["inside"]);
    const mount = mountTagged("paper.html", inside);
    const stray = el("p", {}, ["stray"]);
    document.body.appendChild(stray);
    const strayText = stray.firstChild as Text;
    const sel = selectRange(strayText, 0, strayText, 5);
    expect(computeHtmlSelectionAnchor(mount, sel, "html", undefined)).toBeNull();
  });

  it("emits an HtmlAnchor for hand-authored selections (no data-src ancestor)", () => {
    const p = el("p", {}, ["the quick brown fox"]);
    const mount = mountTagged("paper.html", p);
    const text = p.firstChild as Text;
    const sel = selectRange(text, 4, text, 9);
    const result = computeHtmlSelectionAnchor(mount, sel, "html", undefined);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe("html");
    if (result?.kind !== "html") throw new Error("expected html");
    expect(result.anchor.file).toBe("paper.html");
    expect(result.anchor.charOffsetStart).toBe(4);
    expect(result.anchor.charOffsetEnd).toBe(9);
    expect(result.quote).toBe("quick");
  });

  it("emits a SourceAnchor when the selection sits inside a data-src-file block", () => {
    const p = el(
      "p",
      {
        "data-src-file": "paper.md",
        "data-src-line": "3",
        "data-src-end-line": "3",
        "data-src-col": "0",
      },
      ["hello world"],
    );
    const mount = mountTagged("paper.html", p);
    const text = p.firstChild as Text;
    const sel = selectRange(text, 6, text, 11);
    const result = computeHtmlSelectionAnchor(mount, sel, "source", "paper.md");
    expect(result).not.toBeNull();
    expect(result?.kind).toBe("source");
    if (result?.kind !== "source") throw new Error("expected source");
    expect(result.anchor.file).toBe("paper.md");
    expect(result.anchor.lineStart).toBe(3);
    expect(result.anchor.colStart).toBe(6);
    expect(result.anchor.colEnd).toBe(11);
    expect(result.quote).toBe("world");
  });

  it("captures contextBefore and contextAfter from the surrounding mount text", () => {
    const p1 = el("p", {}, ["one before "]);
    const p2 = el("p", {}, ["the target"]);
    const p3 = el("p", {}, [" two after"]);
    const mount = mountTagged("paper.html", p1, p2, p3);
    const target = p2.firstChild as Text;
    const sel = selectRange(target, 4, target, 10);
    const result = computeHtmlSelectionAnchor(mount, sel, "html", undefined);
    expect(result).not.toBeNull();
    expect(result?.quote).toBe("target");
    expect(result?.contextBefore).toContain("one before");
    expect(result?.contextAfter).toContain("two after");
  });

  it("trims surrounding whitespace from the quote", () => {
    const p = el("p", {}, ["  spaced  "]);
    const mount = mountTagged("paper.html", p);
    const text = p.firstChild as Text;
    const sel = selectRange(text, 0, text, 10);
    const result = computeHtmlSelectionAnchor(mount, sel, "html", undefined);
    expect(result?.quote).toBe("spaced");
  });
});
