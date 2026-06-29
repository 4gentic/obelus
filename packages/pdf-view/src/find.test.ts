import type { TextMarkedContent } from "pdfjs-dist/types/src/display/api";
import { describe, expect, it } from "vitest";
import { mockDoc, mockViewport, ti } from "./__fixtures__/mock-pdf";
import { indexPage, searchPdfDocument, searchPdfDocumentDetailed } from "./find";

// Typographic code points are built from explicit hex so the folded / invisible
// characters under test are unambiguous in tooling — never paste literal glyphs.
const FI = String.fromCodePoint(0xfb01); // U+FB01 LATIN SMALL LIGATURE FI, one code unit
const LDQUO = String.fromCodePoint(0x201c);
const RDQUO = String.fromCodePoint(0x201d);
const NBSP = String.fromCodePoint(0x00a0);

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

  it("exposes an NFKC-folded haystack that expands ligatures, with an offset map", () => {
    const idx = indexPage([ti(`de${FI}nition`)]);
    expect(idx.text).toBe(`de${FI}nition`);
    expect(idx.norm).toBe("definition");
    // Map contract: length === norm.length + 1, final sentinel === original length.
    expect(idx.normMap.length).toBe(idx.norm.length + 1);
    expect(idx.normMap[idx.norm.length]).toBe(idx.text.length);
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

  it("matches an ASCII query against a fi-ligature in the text layer", async () => {
    const doc = mockDoc([{ items: [ti(`de${FI}nition`)], viewport: mockViewport() }]);
    const matches = await searchPdfDocument(doc, "definition");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.rects.length).toBeGreaterThan(0);
  });

  it("matches the ligature substring 'fi' inside the folded text", async () => {
    const doc = mockDoc([{ items: [ti(`de${FI}nition`)], viewport: mockViewport() }]);
    const matches = await searchPdfDocument(doc, "fi");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.rects.length).toBeGreaterThan(0);
  });

  it("folds smart quotes so an ASCII-quoted query matches", async () => {
    const doc = mockDoc([{ items: [ti(`${LDQUO}quote${RDQUO}`)], viewport: mockViewport() }]);
    const matches = await searchPdfDocument(doc, '"quote"');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.rects.length).toBeGreaterThan(0);
  });

  it("normalizes a non-breaking space so a plain-space query matches", async () => {
    const doc = mockDoc([{ items: [ti(`a${NBSP}b`)], viewport: mockViewport() }]);
    const matches = await searchPdfDocument(doc, "a b");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.rects.length).toBeGreaterThan(0);
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

  it("projects an ASCII query back onto a ligature's original item offsets", async () => {
    const doc = mockDoc([{ items: [ti(`de${FI}nition`)], viewport: mockViewport() }]);
    const matches = await searchPdfDocumentDetailed(doc, "definition");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.startItem).toBe(0);
    expect(matches[0]?.startOffset).toBe(0);
    expect(matches[0]?.endItem).toBe(0);
    // endOffset is exclusive and in original coords: all code units of the item.
    expect(matches[0]?.endOffset).toBe(`de${FI}nition`.length);
  });

  it("anchors a 'fi' query to just the single ligature code unit", async () => {
    const doc = mockDoc([{ items: [ti(`de${FI}nition`)], viewport: mockViewport() }]);
    const matches = await searchPdfDocumentDetailed(doc, "fi");
    expect(matches).toHaveLength(1);
    // The ASCII "fi" projects back to the one original code unit (offsets 2..3).
    expect(matches[0]?.startOffset).toBe(2);
    expect(matches[0]?.endOffset).toBe(3);
  });

  it("anchors a single 'f' to the whole ligature glyph it folds from", async () => {
    const doc = mockDoc([{ items: [ti(`de${FI}nition`)], viewport: mockViewport() }]);
    const matches = await searchPdfDocumentDetailed(doc, "f");
    expect(matches).toHaveLength(1);
    // "f" is the first half of the fi-ligature; the match covers the whole
    // original code unit (offsets 2..3) rather than being dropped as a
    // sub-glyph fragment with no anchorable sub-character.
    expect(matches[0]?.startOffset).toBe(2);
    expect(matches[0]?.endOffset).toBe(3);
  });
});
