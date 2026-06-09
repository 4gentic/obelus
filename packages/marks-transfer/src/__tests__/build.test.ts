import { parseMarksArchive } from "@obelus/bundle-schema";
import type { AnnotationRow } from "@obelus/repo";
import { describe, expect, it } from "vitest";
import { buildMarksArchive } from "../build.js";

const pdfRow = (over: Partial<AnnotationRow> = {}): AnnotationRow => ({
  id: "00000000-0000-4000-8000-000000000001",
  revisionId: "rev-1",
  category: "elaborate",
  quote: "the result is significant",
  contextBefore: "we find that ",
  contextAfter: " in all trials",
  anchor: {
    kind: "pdf",
    page: 2,
    bbox: [1, 2, 3, 4],
    textItemRange: { start: [0, 0], end: [1, 5] },
    rects: [[1, 2, 3, 4]],
  },
  note: "expand this",
  thread: [],
  createdAt: "2026-06-08T09:00:00.000Z",
  staleness: "ok",
  ...over,
});

const fixedNow = (): Date => new Date("2026-06-08T10:00:00.000Z");

describe("buildMarksArchive", () => {
  it("emits a versioned archive with the document identity and tool stamp", () => {
    const archive = buildMarksArchive({
      rows: [pdfRow()],
      document: { format: "pdf", title: "Paper", pdfSha256: "a".repeat(64), pageCount: 9 },
      categories: [{ slug: "elaborate", label: "Elaborate" }],
      toolVersion: "0.2.0",
      now: fixedNow,
    });
    expect(archive.marksArchiveVersion).toBe("1.0");
    expect(archive.tool).toEqual({ name: "obelus", version: "0.2.0" });
    expect(archive.exportedAt).toBe("2026-06-08T10:00:00.000Z");
    expect(archive.document).toEqual({
      format: "pdf",
      title: "Paper",
      pdfSha256: "a".repeat(64),
      pageCount: 9,
    });
    expect(archive.marks).toHaveLength(1);
  });

  it("strips revisionId, staleness, and the PDF anchor rects cache from the wire mark", () => {
    const archive = buildMarksArchive({
      rows: [pdfRow()],
      document: { format: "pdf", title: "Paper", pdfSha256: "a".repeat(64) },
      categories: [],
      toolVersion: "0.2.0",
      now: fixedNow,
    });
    const mark = archive.marks[0];
    expect(mark).toBeDefined();
    expect(mark).not.toHaveProperty("revisionId");
    expect(mark).not.toHaveProperty("staleness");
    if (mark?.anchor.kind === "pdf") {
      expect(mark.anchor).not.toHaveProperty("rects");
      expect(mark.anchor.page).toBe(2);
    }
  });

  it("carries groupId only when present", () => {
    const grouped = buildMarksArchive({
      rows: [pdfRow({ groupId: "g-1" })],
      document: { format: "pdf", title: "P", pdfSha256: "a".repeat(64) },
      categories: [],
      toolVersion: "0.2.0",
      now: fixedNow,
    });
    expect(grouped.marks[0]?.groupId).toBe("g-1");

    const ungrouped = buildMarksArchive({
      rows: [pdfRow()],
      document: { format: "pdf", title: "P", pdfSha256: "a".repeat(64) },
      categories: [],
      toolVersion: "0.2.0",
      now: fixedNow,
    });
    expect(ungrouped.marks[0]).not.toHaveProperty("groupId");
  });

  it("round-trips through the wire: a built archive re-parses cleanly", () => {
    const archive = buildMarksArchive({
      rows: [pdfRow({ groupId: "00000000-0000-4000-8000-000000000002" })],
      document: { format: "pdf", title: "Paper", pdfSha256: "a".repeat(64), pageCount: 9 },
      categories: [{ slug: "elaborate", label: "Elaborate" }],
      toolVersion: "0.2.0",
      now: fixedNow,
    });
    const result = parseMarksArchive(JSON.parse(JSON.stringify(archive)));
    expect(result.ok).toBe(true);
  });
});
