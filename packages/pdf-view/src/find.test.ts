import type { TextMarkedContent } from "pdfjs-dist/types/src/display/api";
import { describe, expect, it } from "vitest";
import { mockDoc, mockViewport, ti } from "./__fixtures__/mock-pdf";
import { indexPage, searchPdfDocument, searchPdfDocumentDetailed } from "./find";

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
    expect(idx.itemForChar).toHaveLength(idx.text.length);
    expect(idx.offsetForChar).toHaveLength(idx.text.length);
    expect(idx.itemForChar[5]).toBe(0);
    expect(idx.offsetForChar[5]).toBe(5);
    expect(idx.itemForChar[6]).toBe(1);
    expect(idx.offsetForChar[6]).toBe(0);
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

  it("finds queries across a boundary when the previous item already ends in whitespace", async () => {
    const doc = mockDoc([{ items: [ti("hello "), ti("world")], viewport: mockViewport() }]);
    const spanning = await searchPdfDocument(doc, "hello world");
    expect(spanning).toHaveLength(1);
    const intoSecond = await searchPdfDocument(doc, "world");
    expect(intoSecond).toHaveLength(1);
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

describe("searchPdfDocumentDetailed", () => {
  it("recovers the text-item range of a match (endOffset exclusive)", async () => {
    const doc = mockDoc([{ items: [ti("hello"), ti("world")], viewport: mockViewport() }]);
    const matches = await searchPdfDocumentDetailed(doc, "hello world");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.startItem).toBe(0);
    expect(matches[0]?.startOffset).toBe(0);
    expect(matches[0]?.endItem).toBe(1);
    expect(matches[0]?.endOffset).toBe(5);
  });

  it("agrees with searchPdfDocument on page and count", async () => {
    const doc = mockDoc([
      { items: [ti("intro section")], viewport: mockViewport() },
      { items: [ti("conclusion section")], viewport: mockViewport() },
    ]);
    const detailed = await searchPdfDocumentDetailed(doc, "section");
    const plain = await searchPdfDocument(doc, "section");
    expect(detailed.map((m) => m.pageIndex)).toEqual(plain.map((m) => m.pageIndex));
    expect(detailed).toHaveLength(plain.length);
  });

  it("discards a match that straddles a synthetic word break", async () => {
    const doc = mockDoc([{ items: [ti("hello"), ti("world")], viewport: mockViewport() }]);
    expect(await searchPdfDocumentDetailed(doc, "helloworld")).toEqual([]);
  });
});
