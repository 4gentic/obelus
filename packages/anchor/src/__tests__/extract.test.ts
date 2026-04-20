import type { PageViewport } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { describe, expect, it } from "vitest";
import { CONTEXT_WINDOW, extract } from "../extract";

function ti(str: string, eol = false, x = 0, y = 0): TextItem {
  return {
    str,
    dir: "ltr",
    width: str.length,
    height: 1,
    transform: [1, 0, 0, 1, x, y],
    fontName: "mock",
    hasEOL: eol,
  };
}

// bbox math is exercised by coords tests; here we only need convertToViewportRectangle
// to return a deterministic rectangle so extract()'s bbox field is non-NaN.
const viewport = {
  width: 100,
  height: 100,
  convertToViewportRectangle: (r: number[]) => r,
} as unknown as PageViewport;

describe("extract", () => {
  it("produces a short contextBefore near the start of the page", () => {
    const items = [ti("First sentence. "), ti("Second sentence.")];
    const anchor = {
      pageIndex: 0,
      startItem: 0,
      startOffset: 0,
      endItem: 0,
      endOffset: 5,
    };
    const out = extract(anchor, items, viewport);
    expect(out.quote).toBe("First");
    expect(out.contextBefore).toBe("");
    expect(out.contextAfter.length).toBeGreaterThan(0);
    expect(out.contextAfter.length).toBeLessThanOrEqual(CONTEXT_WINDOW);
  });

  it("produces a short contextAfter near the end of the page", () => {
    const items = [ti("Early. "), ti("Middle. "), ti("The end.")];
    const lastLen = items[2]?.str.length ?? 0;
    const anchor = {
      pageIndex: 0,
      startItem: 2,
      startOffset: lastLen - 4,
      endItem: 2,
      endOffset: lastLen,
    };
    const out = extract(anchor, items, viewport);
    expect(out.quote).toBe("end.");
    expect(out.contextAfter).toBe("");
    expect(out.contextBefore.length).toBeGreaterThan(0);
  });

  it("caps context at CONTEXT_WINDOW when the page is long", () => {
    const filler = "x".repeat(400);
    const items = [ti(filler), ti("ANCHOR"), ti(filler)];
    const anchor = {
      pageIndex: 0,
      startItem: 1,
      startOffset: 0,
      endItem: 1,
      endOffset: 6,
    };
    const out = extract(anchor, items, viewport);
    expect(out.quote).toBe("ANCHOR");
    expect(out.contextBefore.length).toBe(CONTEXT_WINDOW);
    expect(out.contextAfter.length).toBe(CONTEXT_WINDOW);
  });

  it("normalizes ligatures inside the extracted quote", () => {
    const items = [ti("of\uFB01cial")];
    const anchor = {
      pageIndex: 0,
      startItem: 0,
      startOffset: 0,
      endItem: 0,
      endOffset: items[0]?.str.length ?? 0,
    };
    const out = extract(anchor, items, viewport);
    expect(out.quote).toBe("official");
  });

  it("spans multiple items and inserts a space at EOL boundaries", () => {
    const items = [ti("line one", true), ti("line two")];
    const anchor = {
      pageIndex: 0,
      startItem: 0,
      startOffset: 5,
      endItem: 1,
      endOffset: 4,
    };
    const out = extract(anchor, items, viewport);
    expect(out.quote).toBe("one line");
  });

  it("inserts a space between same-line items separated by a horizontal gap", () => {
    // pdf.js emits separate items at font/italic boundaries with no hasEOL;
    // position data (x + width vs. next x) is the only signal we have.
    const items = [ti("runtime", false, 0, 0), ti("whose", false, 20, 0)];
    const anchor = {
      pageIndex: 0,
      startItem: 0,
      startOffset: 0,
      endItem: 1,
      endOffset: items[1]?.str.length ?? 0,
    };
    const out = extract(anchor, items, viewport);
    expect(out.quote).toBe("runtime whose");
  });

  it("inserts a space between items on different baselines without hasEOL", () => {
    // Implicit line wrap: no hasEOL, but baseline drops. Must still separate.
    const items = [ti("line one", false, 0, 10), ti("line two", false, 0, 0)];
    const anchor = {
      pageIndex: 0,
      startItem: 0,
      startOffset: 0,
      endItem: 1,
      endOffset: items[1]?.str.length ?? 0,
    };
    const out = extract(anchor, items, viewport);
    expect(out.quote).toBe("line one line two");
  });

  it("inserts separators inside contextBefore and contextAfter", () => {
    const items = [
      ti("alpha", false, 0, 0),
      ti("beta", false, 10, 0),
      ti("ANCHOR", false, 0, -10),
      ti("gamma", false, 20, -10),
      ti("delta", false, 40, -10),
    ];
    const anchor = {
      pageIndex: 0,
      startItem: 2,
      startOffset: 0,
      endItem: 2,
      endOffset: 6,
    };
    const out = extract(anchor, items, viewport);
    expect(out.quote).toBe("ANCHOR");
    expect(out.contextBefore).toBe("alpha beta");
    expect(out.contextAfter).toBe("gamma delta");
  });
});
