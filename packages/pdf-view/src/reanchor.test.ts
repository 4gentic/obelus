import { extract } from "@obelus/anchor";
import { describe, expect, it } from "vitest";
import { mockDoc, mockViewport, ti } from "./__fixtures__/mock-pdf";
import { reanchorPdfMark } from "./reanchor";

describe("reanchorPdfMark", () => {
  it("recovers the range when item indices shift in the target document", async () => {
    const doc = mockDoc([
      {
        items: [ti("NEW HEADER "), ti("intro "), ti("the target quote"), ti(" tail")],
        viewport: mockViewport(),
      },
    ]);
    const result = await reanchorPdfMark(doc, {
      quote: "the target quote",
      contextBefore: "intro",
      contextAfter: "tail",
      pageHint: 1,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.anchor.page).toBe(1);
      expect(result.anchor.textItemRange.start).toEqual([2, 0]);
      expect(result.anchor.textItemRange.end).toEqual([2, 16]);
    }
  });

  it("uses stored context to pick the right occurrence, overriding a wrong page hint", async () => {
    const doc = mockDoc([
      { items: [ti("alpha "), ti("the quote"), ti(" beta")], viewport: mockViewport() },
      { items: [ti("gamma "), ti("the quote"), ti(" delta")], viewport: mockViewport() },
    ]);
    const result = await reanchorPdfMark(doc, {
      quote: "the quote",
      contextBefore: "alpha",
      contextAfter: "beta",
      pageHint: 2,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.anchor.page).toBe(1);
      expect(result.confidence).toBe("exact-context");
    }
  });

  it("falls back to the page hint when context can't distinguish duplicates", async () => {
    const doc = mockDoc([
      { items: [ti("the quote")], viewport: mockViewport() },
      { items: [ti("the quote")], viewport: mockViewport() },
    ]);
    const result = await reanchorPdfMark(doc, {
      quote: "the quote",
      contextBefore: "",
      contextAfter: "",
      pageHint: 2,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.anchor.page).toBe(2);
      expect(result.confidence).toBe("page-hint");
    }
  });

  it("round-trips: the rebuilt range re-extracts the original quote", async () => {
    const items = [ti("alpha "), ti("the quote"), ti(" beta")];
    const doc = mockDoc([{ items, viewport: mockViewport() }]);
    const result = await reanchorPdfMark(doc, {
      quote: "the quote",
      contextBefore: "alpha",
      contextAfter: "beta",
      pageHint: 1,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const { start, end } = result.anchor.textItemRange;
      const ex = extract(
        {
          pageIndex: 0,
          startItem: start[0],
          startOffset: start[1],
          endItem: end[0],
          endOffset: end[1],
        },
        items,
        mockViewport(),
      );
      expect(ex.quote).toBe("the quote");
    }
  });

  it("ignores a page hint beyond the target's page count", async () => {
    const doc = mockDoc([
      { items: [ti("alpha "), ti("the quote"), ti(" beta")], viewport: mockViewport() },
    ]);
    const result = await reanchorPdfMark(doc, {
      quote: "the quote",
      contextBefore: "alpha",
      contextAfter: "beta",
      pageHint: 5,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.anchor.page).toBe(1);
  });

  it("fails when the quote is absent from the target", async () => {
    const doc = mockDoc([{ items: [ti("hello world")], viewport: mockViewport() }]);
    const result = await reanchorPdfMark(doc, {
      quote: "xylophone",
      contextBefore: "",
      contextAfter: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("quote-not-found");
  });

  it("fails on an empty quote without searching", async () => {
    const doc = mockDoc([{ items: [ti("hello world")], viewport: mockViewport() }]);
    const result = await reanchorPdfMark(doc, { quote: "", contextBefore: "", contextAfter: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("empty-quote");
  });
});
