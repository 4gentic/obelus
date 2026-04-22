import type { PageViewport, PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { TextItem, TextMarkedContent } from "pdfjs-dist/types/src/display/api";
import { describe, expect, it } from "vitest";
import { indexPage, searchPdfDocument } from "./find";

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

describe("indexPage", () => {
  it("maps characters of a single item to (item, offset)", () => {
    const idx = indexPage([ti("hello")]);
    expect(idx.text).toBe("hello");
    expect(Array.from(idx.itemForChar)).toEqual([0, 0, 0, 0, 0]);
    expect(Array.from(idx.offsetForChar)).toEqual([0, 1, 2, 3, 4]);
  });

  it("inserts a synthetic space between items that lack a word break", () => {
    const idx = indexPage([ti("hello"), ti("world")]);
    expect(idx.text).toBe("hello world");
    expect(idx.itemForChar[5]).toBe(-1);
    expect(idx.offsetForChar[5]).toBe(-1);
    expect(idx.itemForChar[6]).toBe(1);
    expect(idx.offsetForChar[6]).toBe(0);
  });

  it("does not add a synthetic space when the previous item already ends in whitespace", () => {
    const idx = indexPage([ti("hello "), ti("world")]);
    expect(idx.text).toBe("hello world");
    expect(idx.itemForChar[5]).toBe(0);
    expect(idx.offsetForChar[5]).toBe(5);
  });

  it("treats hasEOL as a word break (synthetic space inserted)", () => {
    const idx = indexPage([ti("hello", true), ti("world")]);
    expect(idx.text).toBe("hello world");
    expect(idx.itemForChar[5]).toBe(-1);
  });

  it("skips empty items and marked-content markers", () => {
    const marked: TextMarkedContent = { type: "beginMarkedContent", id: "m1" };
    const idx = indexPage([ti("a"), marked, ti(""), ti("b")]);
    expect(idx.items).toHaveLength(2);
    expect(idx.text).toBe("a b");
  });
});

type MockPage = {
  items: TextItem[];
  viewport: PageViewport;
};

function mockViewport(): PageViewport {
  const vp = {
    convertToViewportRectangle: (rect: readonly [number, number, number, number]) =>
      [rect[0], rect[1], rect[2], rect[3]] as [number, number, number, number],
  };
  return vp as unknown as PageViewport;
}

function mockDoc(pages: MockPage[]): PDFDocumentProxy {
  const doc = {
    numPages: pages.length,
    getPage: (n: number): Promise<PDFPageProxy> => {
      const page = pages[n - 1];
      if (!page) return Promise.reject(new Error(`page ${n} missing`));
      const proxy = {
        getTextContent: () => Promise.resolve({ items: page.items, styles: {}, lang: null }),
        getViewport: () => page.viewport,
        cleanup: () => {},
      };
      return Promise.resolve(proxy as unknown as PDFPageProxy);
    },
  };
  return doc as unknown as PDFDocumentProxy;
}

describe("searchPdfDocument", () => {
  it("finds ASCII matches case-insensitively by default", async () => {
    const doc = mockDoc([{ items: [ti("Hello World")], viewport: mockViewport() }]);
    const matches = await searchPdfDocument(doc, "hello");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.pageIndex).toBe(0);
  });

  it("honors caseSensitive: true", async () => {
    const doc = mockDoc([{ items: [ti("Hello hello")], viewport: mockViewport() }]);
    const insensitive = await searchPdfDocument(doc, "hello");
    expect(insensitive).toHaveLength(2);
    const sensitive = await searchPdfDocument(doc, "hello", { caseSensitive: true });
    expect(sensitive).toHaveLength(1);
  });

  it("finds queries that span two items via the synthetic word break", async () => {
    const doc = mockDoc([{ items: [ti("hello"), ti("world")], viewport: mockViewport() }]);
    const matches = await searchPdfDocument(doc, "hello world");
    expect(matches).toHaveLength(1);
  });

  it("returns one match per page across a multi-page document", async () => {
    const doc = mockDoc([
      { items: [ti("intro section")], viewport: mockViewport() },
      { items: [ti("conclusion section")], viewport: mockViewport() },
    ]);
    const matches = await searchPdfDocument(doc, "section");
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.pageIndex)).toEqual([0, 1]);
    expect(matches[0]?.matchIndex).toBe(0);
    expect(matches[1]?.matchIndex).toBe(1);
  });

  it("returns no matches for an absent query", async () => {
    const doc = mockDoc([{ items: [ti("hello world")], viewport: mockViewport() }]);
    const matches = await searchPdfDocument(doc, "xylophone");
    expect(matches).toHaveLength(0);
  });

  it("skips matches that land on a synthetic word-break character", async () => {
    // "helloworld" does not appear — only "hello world" does. The synthetic
    // space lives at char index 5 and must not silently match a query that
    // straddles it without the space.
    const doc = mockDoc([{ items: [ti("hello"), ti("world")], viewport: mockViewport() }]);
    const matches = await searchPdfDocument(doc, "helloworld");
    expect(matches).toHaveLength(0);
  });

  it("returns empty array for an empty query", async () => {
    const doc = mockDoc([{ items: [ti("hello")], viewport: mockViewport() }]);
    expect(await searchPdfDocument(doc, "")).toEqual([]);
  });
});
