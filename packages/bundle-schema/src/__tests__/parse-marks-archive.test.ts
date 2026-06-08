import { describe, expect, it } from "vitest";
import { parseMarksArchive } from "../parse-marks-archive.js";

const validArchive = {
  marksArchiveVersion: "1.0",
  tool: { name: "obelus", version: "0.2.0" },
  exportedAt: "2026-06-08T09:00:00.000Z",
  document: {
    format: "pdf",
    title: "Paper",
    pdfSha256: "a".repeat(64),
    pageCount: 12,
  },
  categories: [{ slug: "elaborate", label: "Elaborate" }],
  marks: [
    {
      id: "00000000-0000-4000-8000-000000000010",
      category: "elaborate",
      quote: "the result is significant",
      contextBefore: "we find that ",
      contextAfter: " in all trials",
      anchor: {
        kind: "pdf",
        page: 1,
        bbox: [0, 0, 10, 10],
        textItemRange: { start: [0, 0], end: [1, 5] },
      },
      createdAt: "2026-06-08T09:00:00.000Z",
    },
  ],
};

describe("parseMarksArchive dispatch", () => {
  it("dispatches a well-formed archive to version '1.0'", () => {
    const result = parseMarksArchive(validArchive);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.version).toBe("1.0");
  });

  it("defaults note and thread on a mark that omits them", () => {
    const result = parseMarksArchive(validArchive);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const mark = result.archive.marks[0];
      expect(mark?.note).toBe("");
      expect(mark?.thread).toEqual([]);
    }
  });

  it("accepts an archive with zero marks", () => {
    const result = parseMarksArchive({ ...validArchive, marks: [] });
    expect(result.ok).toBe(true);
  });

  it("rejects an unsupported marksArchiveVersion with a readable error", () => {
    const result = parseMarksArchive({ ...validArchive, marksArchiveVersion: "9.9" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("unsupported");
  });

  it("rejects input without marksArchiveVersion", () => {
    const result = parseMarksArchive({ tool: { name: "obelus" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("missing marksArchiveVersion");
  });

  it("rejects a malformed pdfSha256", () => {
    const result = parseMarksArchive({
      ...validArchive,
      document: { ...validArchive.document, pdfSha256: "not-a-hash" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("document.pdfSha256");
  });

  it("rejects non-object input", () => {
    expect(parseMarksArchive(null).ok).toBe(false);
    expect(parseMarksArchive("not-an-archive").ok).toBe(false);
  });
});
