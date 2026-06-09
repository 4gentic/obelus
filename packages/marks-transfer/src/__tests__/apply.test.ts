import type { AnnotationRow } from "@obelus/repo";
import { describe, expect, it, vi } from "vitest";
import { applyImportedMarks } from "../apply.js";

const row = (id: string): AnnotationRow => ({
  id,
  revisionId: "rev-T",
  category: "elaborate",
  quote: "q",
  contextBefore: "",
  contextAfter: "",
  anchor: {
    kind: "pdf",
    page: 1,
    bbox: [0, 0, 1, 1],
    textItemRange: { start: [0, 0], end: [0, 1] },
  },
  note: "",
  thread: [],
  createdAt: "2026-06-08T00:00:00.000Z",
});

function fakeWriter() {
  return {
    replaceForRevision: vi.fn().mockResolvedValue(undefined),
    bulkPut: vi.fn().mockResolvedValue(undefined),
  };
}

describe("applyImportedMarks", () => {
  it("replace hands the rows to the atomic swap, never a bare bulkPut", async () => {
    const writer = fakeWriter();
    const rows = [row("a"), row("b")];
    await applyImportedMarks(writer, "rev-T", rows, "replace");

    expect(writer.replaceForRevision).toHaveBeenCalledWith("rev-T", rows);
    expect(writer.bulkPut).not.toHaveBeenCalled();
  });

  it("merge writes the imported rows alongside, without replacing", async () => {
    const writer = fakeWriter();
    const rows = [row("a")];
    await applyImportedMarks(writer, "rev-T", rows, "merge");

    expect(writer.replaceForRevision).not.toHaveBeenCalled();
    expect(writer.bulkPut).toHaveBeenCalledWith("rev-T", rows);
  });
});
