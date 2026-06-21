import type { AnchorFields, AnnotationRow, DiffHunkRow } from "@obelus/repo";
import { describe, expect, it } from "vitest";
import { filesInDocumentOrder, primaryAnnotation, sortByDocumentOrder } from "../document-order";

function sourceAnchor(file: string, lineStart: number, colStart = 0): AnchorFields {
  return { kind: "source", file, lineStart, colStart, lineEnd: lineStart, colEnd: colStart + 1 };
}

function pdfAnchor(page: number, y0: number): AnchorFields {
  return {
    kind: "pdf",
    page,
    bbox: [0, y0, 100, y0 + 10],
    textItemRange: { start: [0, 0], end: [0, 1] },
  };
}

function annotation(id: string, anchor: AnchorFields): AnnotationRow {
  return {
    id,
    revisionId: "rev-1",
    category: "clarity",
    quote: `quote for ${id}`,
    contextBefore: "",
    contextAfter: "",
    anchor,
    note: "",
    thread: [],
    createdAt: "2026-01-01T00:00:00",
  };
}

function hunk(id: string, ordinal: number, annotationIds: string[], file = ""): DiffHunkRow {
  return {
    id,
    sessionId: "sess-1",
    annotationIds,
    file,
    category: null,
    patch: "@@ -1 +1 @@\n-a\n+b\n",
    modifiedPatchText: null,
    state: "pending",
    ambiguous: false,
    emptyReason: null,
    noteText: "",
    reviewerNotes: "",
    ordinal,
    applyFailure: null,
  };
}

const NO_FILE_ORDER: ReadonlyMap<string, number> = new Map();

describe("sortByDocumentOrder", () => {
  it("orders source-anchored hunks by line, regardless of ordinal", () => {
    const anns = new Map<string, AnnotationRow>([
      ["a1", annotation("a1", sourceAnchor("main.tex", 40))],
      ["a2", annotation("a2", sourceAnchor("main.tex", 12))],
      ["a3", annotation("a3", sourceAnchor("main.tex", 25))],
    ]);
    // Ordinals are deliberately out of document order.
    const hunks = [hunk("h1", 0, ["a1"]), hunk("h2", 1, ["a2"]), hunk("h3", 2, ["a3"])];

    const sorted = sortByDocumentOrder(hunks, anns, NO_FILE_ORDER);

    expect(sorted.map((h) => h.id)).toEqual(["h2", "h3", "h1"]);
  });

  it("breaks same-line ties by column", () => {
    const anns = new Map<string, AnnotationRow>([
      ["a1", annotation("a1", sourceAnchor("main.tex", 10, 30))],
      ["a2", annotation("a2", sourceAnchor("main.tex", 10, 4))],
    ]);
    const hunks = [hunk("h1", 0, ["a1"]), hunk("h2", 1, ["a2"])];

    const sorted = sortByDocumentOrder(hunks, anns, NO_FILE_ORDER);

    expect(sorted.map((h) => h.id)).toEqual(["h2", "h1"]);
  });

  it("keeps a file's suggestions contiguous and ranks files by fileOrder", () => {
    const anns = new Map<string, AnnotationRow>([
      ["a1", annotation("a1", sourceAnchor("sections/02-body.tex", 5))],
      ["a2", annotation("a2", sourceAnchor("main.tex", 90))],
      ["a3", annotation("a3", sourceAnchor("main.tex", 3))],
      ["a4", annotation("a4", sourceAnchor("sections/02-body.tex", 1))],
    ]);
    const hunks = [
      hunk("h1", 0, ["a1"], "sections/02-body.tex"),
      hunk("h2", 1, ["a2"], "main.tex"),
      hunk("h3", 2, ["a3"], "main.tex"),
      hunk("h4", 3, ["a4"], "sections/02-body.tex"),
    ];
    // Entrypoint first, then the section file.
    const fileOrder = new Map<string, number>([
      ["main.tex", 0],
      ["sections/02-body.tex", 1],
    ]);

    const sorted = sortByDocumentOrder(hunks, anns, fileOrder);

    // main.tex block (by line: 3, 90) then the section block (1, 5).
    expect(sorted.map((h) => h.id)).toEqual(["h3", "h2", "h4", "h1"]);
  });

  it("falls back to alphabetical file order when fileOrder is empty", () => {
    const anns = new Map<string, AnnotationRow>([
      ["a1", annotation("a1", sourceAnchor("zeta.tex", 1))],
      ["a2", annotation("a2", sourceAnchor("alpha.tex", 99))],
    ]);
    const hunks = [hunk("h1", 0, ["a1"], "zeta.tex"), hunk("h2", 1, ["a2"], "alpha.tex")];

    const sorted = sortByDocumentOrder(hunks, anns, NO_FILE_ORDER);

    expect(sorted.map((h) => h.id)).toEqual(["h2", "h1"]);
  });

  it("orders pdf anchors by page then vertical position (smaller y0 first)", () => {
    const anns = new Map<string, AnnotationRow>([
      ["a1", annotation("a1", pdfAnchor(2, 100))],
      ["a2", annotation("a2", pdfAnchor(1, 700))],
      ["a3", annotation("a3", pdfAnchor(1, 120))],
    ]);
    const hunks = [hunk("h1", 0, ["a1"]), hunk("h2", 1, ["a2"]), hunk("h3", 2, ["a3"])];

    const sorted = sortByDocumentOrder(hunks, anns, NO_FILE_ORDER);

    // page 1 (y0 120, then 700) before page 2 (y0 100).
    expect(sorted.map((h) => h.id)).toEqual(["h3", "h2", "h1"]);
  });

  it("places synthesised/anchorless hunks after anchored ones, by ordinal", () => {
    const anns = new Map<string, AnnotationRow>([
      ["a1", annotation("a1", sourceAnchor("main.tex", 50))],
    ]);
    const hunks = [
      hunk("cascade", 0, ["cascade-1"]),
      hunk("anchored", 5, ["a1"]),
      hunk("quality", 1, ["quality-2"]),
      hunk("unresolved", 2, ["missing-uuid"]),
    ];

    const sorted = sortByDocumentOrder(hunks, anns, NO_FILE_ORDER);

    // Anchored first; then anchorless rows by ordinal: cascade(0) < quality(1)
    // < unresolved(2).
    expect(sorted.map((h) => h.id)).toEqual(["anchored", "cascade", "quality", "unresolved"]);
  });

  it("picks the earliest-anchored mark as the primary for a multi-mark hunk", () => {
    const anns = new Map<string, AnnotationRow>([
      ["late", annotation("late", sourceAnchor("main.tex", 80))],
      ["early", annotation("early", sourceAnchor("main.tex", 8))],
    ]);
    // ids listed late-first; the hunk should still anchor at line 8.
    const h = hunk("merged", 0, ["late", "early"]);

    const primary = primaryAnnotation(h, anns, NO_FILE_ORDER);

    expect(primary?.id).toBe("early");
  });

  it("is a stable total order: equal anchors tiebreak by ordinal", () => {
    const anchor = sourceAnchor("main.tex", 10, 0);
    const anns = new Map<string, AnnotationRow>([
      ["a1", annotation("a1", anchor)],
      ["a2", annotation("a2", anchor)],
      ["a3", annotation("a3", anchor)],
    ]);
    // Same exact anchor; only ordinal distinguishes them.
    const hunks = [hunk("h3", 2, ["a3"]), hunk("h1", 0, ["a1"]), hunk("h2", 1, ["a2"])];

    const sorted = sortByDocumentOrder(hunks, anns, NO_FILE_ORDER);

    expect(sorted.map((h) => h.id)).toEqual(["h1", "h2", "h3"]);
  });

  it("does not mutate the input array", () => {
    const anns = new Map<string, AnnotationRow>([
      ["a1", annotation("a1", sourceAnchor("main.tex", 9))],
      ["a2", annotation("a2", sourceAnchor("main.tex", 1))],
    ]);
    const hunks = [hunk("h1", 0, ["a1"]), hunk("h2", 1, ["a2"])];

    sortByDocumentOrder(hunks, anns, NO_FILE_ORDER);

    expect(hunks.map((h) => h.id)).toEqual(["h1", "h2"]);
  });
});

describe("filesInDocumentOrder", () => {
  it("returns files in the order their first suggestion appears", () => {
    const anns = new Map<string, AnnotationRow>([
      ["a1", annotation("a1", sourceAnchor("b.tex", 5))],
      ["a2", annotation("a2", sourceAnchor("a.tex", 5))],
      ["a3", annotation("a3", sourceAnchor("b.tex", 1))],
    ]);
    const fileOrder = new Map<string, number>([
      ["a.tex", 0],
      ["b.tex", 1],
    ]);
    const hunks = [
      hunk("h1", 0, ["a1"], "b.tex"),
      hunk("h2", 1, ["a2"], "a.tex"),
      hunk("h3", 2, ["a3"], "b.tex"),
    ];

    const files = filesInDocumentOrder(hunks, (h) => h.file, anns, fileOrder);

    expect(files).toEqual(["a.tex", "b.tex"]);
  });
});
