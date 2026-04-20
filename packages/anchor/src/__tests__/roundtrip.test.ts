import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PdfAnchor } from "@obelus/bundle-schema";
// The legacy build is the one that runs under plain Node without a DOM.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { describe, expect, it } from "vitest";
import { CONTEXT_WINDOW, extract } from "../extract";
import type { Anchor } from "../types";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, "..", "..", "fixtures", "simple.pdf");

async function loadPage(pageIndex: number) {
  const data = readFileSync(fixturePath);
  const doc = await getDocument({
    data: new Uint8Array(data),
    isEvalSupported: false,
    disableFontFace: true,
    // 0 = errors only; suppresses the harmless standard-font fetch warning
    // (happy-dom rewrites URL resolution in a way pdfjs can't satisfy, and
    // we only need TextItems, not rendered glyphs).
    verbosity: 0,
  }).promise;
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  return { items: content.items as TextItem[], viewport };
}

function toPdfAnchor(a: Anchor, bbox: readonly [number, number, number, number]) {
  return {
    kind: "pdf" as const,
    page: a.pageIndex + 1,
    bbox: [bbox[0], bbox[1], bbox[2], bbox[3]] as [number, number, number, number],
    textItemRange: {
      start: [a.startItem, a.startOffset] as [number, number],
      end: [a.endItem, a.endOffset] as [number, number],
    },
  };
}

function fromPdfAnchor(p: {
  page: number;
  textItemRange: { start: [number, number]; end: [number, number] };
}): Anchor {
  return {
    pageIndex: p.page - 1,
    startItem: p.textItemRange.start[0],
    startOffset: p.textItemRange.start[1],
    endItem: p.textItemRange.end[0],
    endOffset: p.textItemRange.end[1],
  };
}

describe("anchor round-trip against a real pdfjs TextItem stream", () => {
  it("extracts the first line as a quote with no leading context", async () => {
    const { items, viewport } = await loadPage(0);
    const line0 = items[0] as TextItem;
    const anchor: Anchor = {
      pageIndex: 0,
      startItem: 0,
      startOffset: 0,
      endItem: 0,
      endOffset: line0.str.length,
    };
    const out = extract(anchor, items, viewport);
    expect(out.quote).toBe("Obelus marks what the reader doubts.");
    expect(out.contextBefore).toBe("");
    expect(out.contextAfter.startsWith("Writing AI papers")).toBe(true);
    expect(out.bbox.every(Number.isFinite)).toBe(true);
  });

  it("spans an EOL boundary between two lines and collapses to a single space", async () => {
    // pdfjs flags the last item of each line with hasEOL=true; the extractor
    // should bridge that boundary and produce one word break.
    const { items, viewport } = await loadPage(0);
    const cheapItem = items[1] as TextItem;
    const cheapStr = cheapItem.str;
    const startOffset = cheapStr.indexOf("cheap.");
    expect(startOffset).toBeGreaterThanOrEqual(0);
    const anchor: Anchor = {
      pageIndex: 0,
      startItem: 1,
      startOffset,
      endItem: 2,
      endOffset: "Reviewing".length,
    };
    const out = extract(anchor, items, viewport);
    expect(out.quote).toBe("cheap. Reviewing");
  });

  it("clamps context to CONTEXT_WINDOW and stays a string", async () => {
    const { items, viewport } = await loadPage(0);
    const anchor: Anchor = {
      pageIndex: 0,
      startItem: 2,
      startOffset: 0,
      endItem: 2,
      endOffset: (items[2] as TextItem).str.length,
    };
    const out = extract(anchor, items, viewport);
    expect(out.quote).toBe("Reviewing them is the work.");
    expect(out.contextBefore.length).toBeLessThanOrEqual(CONTEXT_WINDOW);
    expect(out.contextAfter.length).toBeLessThanOrEqual(CONTEXT_WINDOW);
  });

  it("survives PdfAnchor schema serialize → parse → re-extract with a stable quote", async () => {
    const { items, viewport } = await loadPage(0);
    const anchor: Anchor = {
      pageIndex: 0,
      startItem: 0,
      startOffset: "Obelus marks ".length,
      endItem: 0,
      endOffset: "Obelus marks what the reader".length,
    };
    const first = extract(anchor, items, viewport);
    expect(first.quote).toBe("what the reader");

    const serialized = toPdfAnchor(anchor, first.bbox);
    const parsed = PdfAnchor.parse(JSON.parse(JSON.stringify(serialized)));
    const second = extract(fromPdfAnchor(parsed), items, viewport);
    expect(second.quote).toBe(first.quote);
    expect(second.contextBefore).toBe(first.contextBefore);
    expect(second.contextAfter).toBe(first.contextAfter);
    expect(second.bbox).toEqual(first.bbox);
  });
});
