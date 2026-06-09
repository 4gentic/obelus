import type { MarksArchive, MarksArchiveMark } from "@obelus/bundle-schema";
import type { AnnotationRow } from "@obelus/repo";
import { describe, expect, it } from "vitest";
import type { MarksWriter } from "../apply.js";
import { buildMarksArchiveForExport, MARKS_TOOL_VERSION, runMarksImport } from "../orchestrate.js";

let counter = 0;
const newId = (): string => {
  counter += 1;
  return `new-${counter}`;
};

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

function recordingWriter(): MarksWriter & { calls: Array<{ mode: string; count: number }> } {
  const calls: Array<{ mode: string; count: number }> = [];
  return {
    calls,
    async bulkPut(_revisionId: string, rows: AnnotationRow[]): Promise<void> {
      calls.push({ mode: "merge", count: rows.length });
    },
    async replaceForRevision(_revisionId: string, rows: AnnotationRow[]): Promise<void> {
      calls.push({ mode: "replace", count: rows.length });
    },
  };
}

describe("buildMarksArchiveForExport", () => {
  it("stamps the shared tool version and the default category set", () => {
    const archive = buildMarksArchiveForExport({
      rows: [],
      format: "pdf",
      title: "Paper",
      pdfSha256: "a".repeat(64),
      pageCount: 3,
    });
    expect(archive.tool.version).toBe(MARKS_TOOL_VERSION);
    expect(archive.categories.length).toBeGreaterThan(0);
    expect(archive.document.pageCount).toBe(3);
  });
});

describe("runMarksImport", () => {
  it("persists in the chosen mode and reports a success tone", async () => {
    const writer = recordingWriter();
    const outcome = await runMarksImport({
      archive: archiveOf([pdfMark()]),
      writer,
      targetRevisionId: "rev-T",
      targetPdfSha256: "a".repeat(64),
      targetFormat: "pdf",
      mode: "replace",
      existingCount: 4,
      newId,
    });
    expect(outcome.tone).toBe("done");
    expect(outcome.importedCount).toBe(1);
    expect(writer.calls).toEqual([{ mode: "replace", count: 1 }]);
  });

  it("flags an unimportable format mismatch as an error tone", async () => {
    const writer = recordingWriter();
    const outcome = await runMarksImport({
      archive: archiveOf([pdfMark()]),
      writer,
      targetRevisionId: "rev-T",
      targetPdfSha256: "b".repeat(64),
      targetFormat: "md",
      mode: "merge",
      existingCount: 0,
      newId,
    });
    expect(outcome.tone).toBe("error");
    expect(outcome.importedCount).toBe(0);
  });
});
