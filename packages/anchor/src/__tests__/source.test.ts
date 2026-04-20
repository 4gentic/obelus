import { Window } from "happy-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { selectionToSourceAnchor, verifySourceAnchor } from "../source";

let win: Window;
let doc: Document;

beforeEach(() => {
  win = new Window();
  doc = win.document as unknown as Document;
});

function makeBlock(
  tag: string,
  attrs: { file: string; line: number; col: number },
  text: string,
): HTMLElement {
  const el = doc.createElement(tag);
  el.setAttribute("data-src-file", attrs.file);
  el.setAttribute("data-src-line", String(attrs.line));
  el.setAttribute("data-src-col", String(attrs.col));
  el.textContent = text;
  doc.body.appendChild(el);
  return el;
}

describe("selectionToSourceAnchor", () => {
  it("captures a single-block selection with column refinement", () => {
    const p = makeBlock("p", { file: "doc.md", line: 5, col: 0 }, "Hello world");
    const text = p.firstChild;
    if (!text) throw new Error("expected text node");
    const anchor = selectionToSourceAnchor({
      anchorNode: text,
      anchorOffset: 0,
      focusNode: text,
      focusOffset: 5,
    });
    expect(anchor).toEqual({
      kind: "source",
      file: "doc.md",
      lineStart: 5,
      colStart: 0,
      lineEnd: 5,
      colEnd: 5,
    });
  });

  it("orders backwards selections so start precedes end", () => {
    const p = makeBlock("p", { file: "doc.md", line: 1, col: 0 }, "Hello world");
    const text = p.firstChild;
    if (!text) throw new Error("expected text node");
    const anchor = selectionToSourceAnchor({
      anchorNode: text,
      anchorOffset: 9,
      focusNode: text,
      focusOffset: 2,
    });
    expect(anchor?.colStart).toBe(2);
    expect(anchor?.colEnd).toBe(9);
  });

  it("captures cross-block selections with each endpoint's line", () => {
    const a = makeBlock("p", { file: "doc.md", line: 1, col: 0 }, "First.");
    const b = makeBlock("p", { file: "doc.md", line: 3, col: 0 }, "Second.");
    const ta = a.firstChild;
    const tb = b.firstChild;
    if (!ta || !tb) throw new Error("expected text nodes");
    const anchor = selectionToSourceAnchor({
      anchorNode: ta,
      anchorOffset: 0,
      focusNode: tb,
      focusOffset: 6,
    });
    expect(anchor?.lineStart).toBe(1);
    expect(anchor?.lineEnd).toBe(3);
  });

  it("returns null when an endpoint is outside any data-src-file block", () => {
    const stray = doc.createElement("div"); // no data-src-file
    doc.body.appendChild(stray);
    const text = doc.createTextNode("orphan");
    stray.appendChild(text);
    const anchor = selectionToSourceAnchor({
      anchorNode: text,
      anchorOffset: 0,
      focusNode: text,
      focusOffset: 6,
    });
    expect(anchor).toBeNull();
  });

  it("rejects cross-file selections", () => {
    const a = makeBlock("p", { file: "a.md", line: 1, col: 0 }, "A");
    const b = makeBlock("p", { file: "b.md", line: 1, col: 0 }, "B");
    const ta = a.firstChild;
    const tb = b.firstChild;
    if (!ta || !tb) throw new Error("expected text nodes");
    const anchor = selectionToSourceAnchor({
      anchorNode: ta,
      anchorOffset: 0,
      focusNode: tb,
      focusOffset: 1,
    });
    expect(anchor).toBeNull();
  });
});

describe("verifySourceAnchor", () => {
  it("returns ok when the file slice matches the quote (NFKC + whitespace)", () => {
    const file = "intro\nWe claim Z is PSD.\nrefs\n";
    // Half-open interval: colStart inclusive, colEnd exclusive — same as DOM Range.
    expect(
      verifySourceAnchor(
        { kind: "source", file: "doc.md", lineStart: 2, colStart: 9, lineEnd: 2, colEnd: 17 },
        file,
        "Z is PSD",
      ),
    ).toEqual({ ok: true });
  });

  it("returns line-out-of-range when bounds escape the file", () => {
    expect(
      verifySourceAnchor(
        { kind: "source", file: "doc.md", lineStart: 99, colStart: 0, lineEnd: 99, colEnd: 0 },
        "short.\n",
        "anything",
      ),
    ).toEqual({ ok: false, reason: "line-out-of-range" });
  });

  it("returns quote-mismatch when the slice doesn't normalize to the expected quote", () => {
    const result = verifySourceAnchor(
      { kind: "source", file: "doc.md", lineStart: 1, colStart: 0, lineEnd: 1, colEnd: 5 },
      "wrong\n",
      "right",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("quote-mismatch");
  });

  it("normalizes ligatures so the verifier survives PDF-style \uFB01 in the source", () => {
    // "of\uFB01cial" is 7 UTF-16 code units; the slice [0,7) covers it whole.
    expect(
      verifySourceAnchor(
        { kind: "source", file: "doc.md", lineStart: 1, colStart: 0, lineEnd: 1, colEnd: 7 },
        "of\uFB01cial\n",
        "official",
      ),
    ).toEqual({ ok: true });
  });
});
