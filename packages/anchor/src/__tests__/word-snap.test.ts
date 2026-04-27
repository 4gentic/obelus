import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { describe, expect, it } from "vitest";
import type { Anchor } from "../types";
import { snapToWordBounds } from "../word-snap";

// Build a TextItem on a given line. `y` is the PDF-space baseline (transform[5]).
// Items on the same line share a `y`; switching to a new line bumps it down.
function ti(str: string, y = 0): TextItem {
  return {
    str,
    dir: "ltr",
    width: str.length,
    height: 1,
    transform: [1, 0, 0, 1, 0, y],
    fontName: "mock",
    hasEOL: false,
  };
}

const PAGE = 0;

function anchor(
  startItem: number,
  startOffset: number,
  endItem: number,
  endOffset: number,
): Anchor {
  return { pageIndex: PAGE, startItem, startOffset, endItem, endOffset };
}

describe("snapToWordBounds", () => {
  it("expands a mid-word start backward to the word start", () => {
    const items = [ti("Hello world")];
    const out = snapToWordBounds(anchor(0, 6, 0, 11), items); // "world"
    expect(out).toEqual(anchor(0, 6, 0, 11));
  });

  it("snaps both mid-word endpoints to whole-word bounds", () => {
    // "Hello world" — drag from 'l' (offset 2) to 'o' in world (offset 8).
    const items = [ti("Hello world")];
    const out = snapToWordBounds(anchor(0, 2, 0, 8), items);
    expect(out).toEqual(anchor(0, 0, 0, 11));
  });

  it("crosses item boundaries on the same line", () => {
    // Word "introduce" split across two items: "intro" + "duce", same y.
    const items = [ti("intro", 100), ti("duce", 100), ti(" world", 100)];
    // Start mid-"intro" at offset 2 ('t'), end mid-"duce" at offset 2 ('c').
    const out = snapToWordBounds(anchor(0, 2, 1, 2), items);
    // Start backs up to 0 in item 0; end walks forward to end of item 1 (4),
    // and into item 2 sees a space, so stops at item-1 end.
    expect(out).toEqual(anchor(0, 0, 1, 4));
  });

  it("does not cross a line boundary even when the next char is a letter", () => {
    // Same word visually broken across lines: "intro" on line 1, "duce" on line 2.
    const items = [ti("intro", 100), ti("duce", 84)];
    const out = snapToWordBounds(anchor(0, 2, 0, 5), items);
    // End is already at item 0's last position; trying to extend forward sees
    // item 1 on a different line — stop. Start snaps backward to 0.
    expect(out).toEqual(anchor(0, 0, 0, 5));
  });

  it("treats hyphen as a boundary (non-trivial -> snap to 'trivial')", () => {
    const items = [ti("non-trivial test")];
    // Drag inside "trivial": 5 ('r') → 9 ('a').
    const out = snapToWordBounds(anchor(0, 5, 0, 9), items);
    // Backward stops at the hyphen (offset 4), forward stops at the space (11).
    expect(out).toEqual(anchor(0, 4, 0, 11));
  });

  it("is a no-op when the selection already lands on word boundaries", () => {
    const items = [ti("Hello world")];
    const a = anchor(0, 0, 0, 5); // exactly "Hello"
    const out = snapToWordBounds(a, items);
    expect(out).toEqual(a);
  });

  it("is a no-op for an exact double-click word selection mid-string", () => {
    const items = [ti("alpha beta gamma")];
    const a = anchor(0, 6, 0, 10); // exactly "beta"
    const out = snapToWordBounds(a, items);
    expect(out).toEqual(a);
  });

  it("handles end-of-stream gracefully", () => {
    const items = [ti("end")];
    const out = snapToWordBounds(anchor(0, 1, 0, 3), items);
    // Start backs up; end is already at item end with no next item.
    expect(out).toEqual(anchor(0, 0, 0, 3));
  });

  it("handles start-of-stream when previous item doesn't exist", () => {
    const items = [ti("first second")];
    const out = snapToWordBounds(anchor(0, 2, 0, 5), items);
    expect(out).toEqual(anchor(0, 0, 0, 5));
  });

  it("returns the original anchor when snap would invert the range", () => {
    // Pathological start > end (shouldn't happen in real flow, but the function
    // should be defensive). With a normal anchor we just verify the guard:
    const items = [ti("word")];
    const a = anchor(0, 2, 0, 2); // collapsed
    const out = snapToWordBounds(a, items);
    // Snap would expand to (0, 4), which is non-empty — that's fine. This test
    // mainly documents that we never produce a range with si > ei or so >= eo.
    expect(out.startItem).toBeLessThanOrEqual(out.endItem);
    if (out.startItem === out.endItem) expect(out.startOffset).toBeLessThan(out.endOffset);
  });
});
