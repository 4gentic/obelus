import { Window } from "happy-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { imageElementToHtmlAnchor, selectionToHtmlAnchor, verifyHtmlAnchor } from "../html";

let win: Window;
let doc: Document;
let root: HTMLElement;

beforeEach(() => {
  win = new Window();
  doc = win.document as unknown as Document;
  root = doc.createElement("article");
  root.setAttribute("data-html-file", "page.html");
  doc.body.appendChild(root);
});

describe("selectionToHtmlAnchor", () => {
  it("captures an anchor over a single text node with stable xpath", () => {
    const p = doc.createElement("p");
    p.textContent = "Hello world";
    root.appendChild(p);
    const text = p.firstChild;
    if (!text) throw new Error("expected text node");

    const anchor = selectionToHtmlAnchor({
      anchorNode: text,
      anchorOffset: 0,
      focusNode: text,
      focusOffset: 5,
    });
    expect(anchor).toEqual({
      kind: "html",
      file: "page.html",
      xpath: "./p[1]/text()[1]",
      charOffsetStart: 0,
      charOffsetEnd: 5,
    });
  });

  it("counts char offsets across sibling blocks (whole-root char index)", () => {
    const a = doc.createElement("p");
    a.textContent = "First.";
    root.appendChild(a);
    const b = doc.createElement("p");
    b.textContent = "Second.";
    root.appendChild(b);
    const ta = a.firstChild;
    const tb = b.firstChild;
    if (!ta || !tb) throw new Error("expected text nodes");

    const anchor = selectionToHtmlAnchor({
      anchorNode: ta,
      anchorOffset: 0,
      focusNode: tb,
      focusOffset: 7,
    });
    expect(anchor?.charOffsetStart).toBe(0);
    expect(anchor?.charOffsetEnd).toBe(13);
  });

  it("picks the second matching tag for xpath positional indexing", () => {
    const p1 = doc.createElement("p");
    p1.textContent = "one";
    const p2 = doc.createElement("p");
    p2.textContent = "two";
    root.appendChild(p1);
    root.appendChild(p2);
    const text = p2.firstChild;
    if (!text) throw new Error("expected text node");
    const anchor = selectionToHtmlAnchor({
      anchorNode: text,
      anchorOffset: 0,
      focusNode: text,
      focusOffset: 3,
    });
    expect(anchor?.xpath).toBe("./p[2]/text()[1]");
  });

  it("returns null when no data-html-file ancestor is present", () => {
    const stray = doc.createElement("div");
    doc.body.appendChild(stray);
    const text = doc.createTextNode("orphan");
    stray.appendChild(text);
    expect(
      selectionToHtmlAnchor({
        anchorNode: text,
        anchorOffset: 0,
        focusNode: text,
        focusOffset: 1,
      }),
    ).toBeNull();
  });

  it("attaches an optional sourceHint", () => {
    const p = doc.createElement("p");
    p.textContent = "Hi";
    root.appendChild(p);
    const text = p.firstChild;
    if (!text) throw new Error("expected text node");
    const anchor = selectionToHtmlAnchor(
      { anchorNode: text, anchorOffset: 0, focusNode: text, focusOffset: 2 },
      { kind: "source", file: "src.tex", lineStart: 5, colStart: 0, lineEnd: 5, colEnd: 2 },
    );
    expect(anchor?.sourceHint?.file).toBe("src.tex");
  });
});

describe("verifyHtmlAnchor", () => {
  it("returns ok when the slice matches", () => {
    const p = doc.createElement("p");
    p.textContent = "Hello world";
    root.appendChild(p);
    expect(
      verifyHtmlAnchor(
        {
          kind: "html",
          file: "page.html",
          xpath: "./p[1]/text()[1]",
          charOffsetStart: 0,
          charOffsetEnd: 5,
        },
        root,
        "Hello",
      ),
    ).toEqual({ ok: true });
  });

  it("returns out-of-range when offsets exceed the rendered text length", () => {
    root.textContent = "short";
    expect(
      verifyHtmlAnchor(
        {
          kind: "html",
          file: "page.html",
          xpath: "./text()[1]",
          charOffsetStart: 0,
          charOffsetEnd: 999,
        },
        root,
        "short",
      ),
    ).toEqual({ ok: false, reason: "out-of-range" });
  });

  it("returns quote-mismatch when the slice doesn't normalize to the expected quote", () => {
    const p = doc.createElement("p");
    p.textContent = "Hello world";
    root.appendChild(p);
    const result = verifyHtmlAnchor(
      {
        kind: "html",
        file: "page.html",
        xpath: "./p[1]/text()[1]",
        charOffsetStart: 0,
        charOffsetEnd: 5,
      },
      root,
      "world",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("quote-mismatch");
  });
});

describe("imageElementToHtmlAnchor", () => {
  it("builds an element-only anchor for a top-level image", () => {
    const img = doc.createElement("img");
    img.setAttribute("src", "fig.png");
    img.setAttribute("alt", "a figure");
    root.appendChild(img);

    const anchor = imageElementToHtmlAnchor(img as unknown as HTMLElement);
    expect(anchor).toEqual({
      kind: "html-element",
      file: "page.html",
      xpath: "./img[1]",
    });
  });

  it("builds a stable xpath for a nested image", () => {
    const figure = doc.createElement("figure");
    const img = doc.createElement("img");
    img.setAttribute("src", "fig.png");
    figure.appendChild(img);
    root.appendChild(figure);

    const anchor = imageElementToHtmlAnchor(img as unknown as HTMLElement);
    expect(anchor?.xpath).toBe("./figure[1]/img[1]");
  });

  it("attaches an optional sourceHint", () => {
    const img = doc.createElement("img");
    img.setAttribute("src", "fig.png");
    root.appendChild(img);

    const anchor = imageElementToHtmlAnchor(img as unknown as HTMLElement, {
      kind: "source",
      file: "paper.md",
      lineStart: 12,
      colStart: 0,
      lineEnd: 12,
      colEnd: 0,
    });
    expect(anchor?.sourceHint?.lineStart).toBe(12);
  });

  it("returns null for an image outside any data-html-file root", () => {
    const detached = doc.createElement("div");
    const img = doc.createElement("img");
    detached.appendChild(img);
    doc.body.appendChild(detached);

    expect(imageElementToHtmlAnchor(img as unknown as HTMLElement)).toBeNull();
  });
});
