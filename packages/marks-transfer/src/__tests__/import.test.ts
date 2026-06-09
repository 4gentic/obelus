import type { MarksArchive, MarksArchiveMark } from "@obelus/bundle-schema";
import type { AnchorFields } from "@obelus/repo";
import { beforeEach, describe, expect, it } from "vitest";
import { importMarksArchive } from "../import.js";

let counter = 0;
const newId = (): string => {
  counter += 1;
  return `new-${counter}`;
};

beforeEach(() => {
  counter = 0;
});

const pdfMark = (over: Partial<MarksArchiveMark> = {}): MarksArchiveMark => ({
  id: "src-1",
  category: "elaborate",
  quote: "the result is significant",
  contextBefore: "we find that ",
  contextAfter: " in all trials",
  anchor: {
    kind: "pdf",
    page: 2,
    bbox: [1, 2, 3, 4],
    textItemRange: { start: [0, 0], end: [1, 5] },
  },
  note: "expand",
  thread: [],
  createdAt: "2026-06-08T09:00:00.000Z",
  ...over,
});

const archiveOf = (
  marks: MarksArchiveMark[],
  document: Partial<MarksArchive["document"]> = {},
): MarksArchive => ({
  marksArchiveVersion: "1.0",
  tool: { name: "obelus", version: "0.2.0" },
  exportedAt: "2026-06-08T10:00:00.000Z",
  document: { format: "pdf", title: "Paper", pdfSha256: "a".repeat(64), ...document },
  categories: [{ slug: "elaborate", label: "Elaborate" }],
  marks,
});

describe("importMarksArchive", () => {
  it("imports verbatim on an exact hash match", async () => {
    const { rows, report } = await importMarksArchive({
      archive: archiveOf([pdfMark()]),
      targetRevisionId: "rev-T",
      targetPdfSha256: "a".repeat(64),
      targetFormat: "pdf",
      targetCategorySlugs: new Set(["elaborate"]),
      reanchor: async () => {
        throw new Error("must not re-anchor on an exact match");
      },
      newId,
    });
    expect(report.hashMatch).toBe("exact");
    expect(report.matched).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.revisionId).toBe("rev-T");
    expect(rows[0]?.id).not.toBe("src-1");
    expect(rows[0]?.staleness).toBe("ok");
    expect(rows[0]?.anchor).toEqual(pdfMark().anchor);
    expect(report.message).toBe("Imported 1 mark.");
  });

  it("re-anchors when the hash differs and the quote is found", async () => {
    const newAnchor: AnchorFields = {
      kind: "pdf",
      page: 3,
      bbox: [5, 6, 7, 8],
      textItemRange: { start: [2, 0], end: [3, 5] },
    };
    const { rows, report } = await importMarksArchive({
      archive: archiveOf([pdfMark()]),
      targetRevisionId: "rev-T",
      targetPdfSha256: "b".repeat(64),
      targetFormat: "pdf",
      targetCategorySlugs: new Set(["elaborate"]),
      reanchor: async () => newAnchor,
      newId,
    });
    expect(report.hashMatch).toBe("mismatch");
    expect(report.reanchored).toBe(1);
    expect(report.flagged).toBe(0);
    expect(rows[0]?.anchor).toEqual(newAnchor);
    expect(rows[0]?.staleness).toBe("ok");
    expect(report.message).toContain("re-anchored 1");
  });

  it("keeps and flags a mark when the quote can't be re-located", async () => {
    const { rows, report } = await importMarksArchive({
      archive: archiveOf([pdfMark()]),
      targetRevisionId: "rev-T",
      targetPdfSha256: "b".repeat(64),
      targetFormat: "pdf",
      targetCategorySlugs: new Set(["elaborate"]),
      reanchor: async () => null,
      newId,
    });
    expect(report.flagged).toBe(1);
    expect(report.reanchored).toBe(0);
    expect(rows[0]?.staleness).toBe("quote-mismatch");
    expect(rows[0]?.anchor).toEqual(pdfMark().anchor);
    expect(report.flaggedIds).toEqual([rows[0]?.id]);
  });

  it("flags every mark on a hash mismatch when no reanchor is available", async () => {
    const { report } = await importMarksArchive({
      archive: archiveOf([pdfMark(), pdfMark({ id: "src-2" })]),
      targetRevisionId: "rev-T",
      targetPdfSha256: "b".repeat(64),
      targetFormat: "pdf",
      targetCategorySlugs: new Set(["elaborate"]),
      newId,
    });
    expect(report.flagged).toBe(2);
    expect(report.flaggedIds).toHaveLength(2);
  });

  it("skips marks whose anchor can't apply to the target format", async () => {
    const { rows, report } = await importMarksArchive({
      archive: archiveOf([pdfMark()]),
      targetRevisionId: "rev-T",
      targetPdfSha256: "a".repeat(64),
      targetFormat: "md",
      targetCategorySlugs: new Set(["elaborate"]),
      newId,
    });
    expect(report.hashMatch).toBe("format-mismatch");
    expect(report.skipped).toBe(1);
    expect(report.droppedIds).toEqual(["src-1"]);
    expect(rows).toHaveLength(0);
    expect(report.message).toContain("Cannot import");
  });

  it("remaps a shared groupId to one stable fresh id", async () => {
    const { rows } = await importMarksArchive({
      archive: archiveOf([
        pdfMark({ id: "src-1", groupId: "g-src" }),
        pdfMark({ id: "src-2", groupId: "g-src" }),
      ]),
      targetRevisionId: "rev-T",
      targetPdfSha256: "a".repeat(64),
      targetFormat: "pdf",
      targetCategorySlugs: new Set(["elaborate"]),
      newId,
    });
    expect(rows[0]?.groupId).toBeDefined();
    expect(rows[0]?.groupId).toBe(rows[1]?.groupId);
    expect(rows[0]?.groupId).not.toBe("g-src");
  });

  it("reports categories absent from the target project without dropping marks", async () => {
    const { rows, report } = await importMarksArchive({
      archive: archiveOf([pdfMark({ category: "nitpick" })]),
      targetRevisionId: "rev-T",
      targetPdfSha256: "a".repeat(64),
      targetFormat: "pdf",
      targetCategorySlugs: new Set(["elaborate"]),
      newId,
    });
    expect(report.unknownCategories).toEqual(["nitpick"]);
    expect(rows[0]?.category).toBe("nitpick");
    expect(report.message).toContain("categories not in this project");
  });

  it("returns the empty-archive message when there are no marks", async () => {
    const { rows, report } = await importMarksArchive({
      archive: archiveOf([]),
      targetRevisionId: "rev-T",
      targetPdfSha256: "a".repeat(64),
      targetFormat: "pdf",
      targetCategorySlugs: new Set(),
      newId,
    });
    expect(rows).toHaveLength(0);
    expect(report.message).toBe("This archive has no marks.");
  });
});
