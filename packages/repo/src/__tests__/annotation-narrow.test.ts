import { describe, expect, expectTypeOf, it } from "vitest";
import { isPdfAnchored } from "../annotation-narrow";
import type { AnnotationRow } from "../types";

const baseFields = {
  id: "a1",
  revisionId: "rev",
  category: "elaborate",
  quote: "q",
  contextBefore: "",
  contextAfter: "",
  note: "",
  thread: [] as Array<{ at: string; body: string }>,
  createdAt: "2026-04-25T00:00:00.000Z",
};

describe("isPdfAnchored", () => {
  it("returns true for a row whose anchor.kind is 'pdf'", () => {
    const row: AnnotationRow = {
      ...baseFields,
      anchor: {
        kind: "pdf",
        page: 1,
        bbox: [0, 0, 1, 1],
        textItemRange: { start: [0, 0], end: [0, 1] },
      },
    };
    expect(isPdfAnchored(row)).toBe(true);
  });

  it("returns false for a row whose anchor.kind is 'source'", () => {
    const row: AnnotationRow = {
      ...baseFields,
      anchor: {
        kind: "source",
        file: "paper.md",
        lineStart: 1,
        colStart: 0,
        lineEnd: 1,
        colEnd: 5,
      },
    };
    expect(isPdfAnchored(row)).toBe(false);
  });

  it("narrows row.anchor to the PDF arm inside the guard", () => {
    const row: AnnotationRow = {
      ...baseFields,
      anchor: {
        kind: "pdf",
        page: 7,
        bbox: [0, 0, 1, 1],
        textItemRange: { start: [0, 0], end: [0, 1] },
      },
    };
    if (isPdfAnchored(row)) {
      expectTypeOf(row.anchor.kind).toEqualTypeOf<"pdf">();
      expectTypeOf(row.anchor.page).toEqualTypeOf<number>();
      expectTypeOf(row.anchor.bbox).toEqualTypeOf<[number, number, number, number]>();
      expect(row.anchor.page).toBe(7);
    } else {
      throw new Error("expected the PDF row to narrow");
    }
  });
});
