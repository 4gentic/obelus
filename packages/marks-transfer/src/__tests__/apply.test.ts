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
    clearForRevision: vi.fn().mockResolvedValue(undefined),
    bulkPut: vi.fn().mockResolvedValue(undefined),
  };
}

describe("applyImportedMarks", () => {
  it("replace clears the revision before writing the imported rows", async () => {
    const writer = fakeWriter();
    const rows = [row("a"), row("b")];
    await applyImportedMarks(writer, "rev-T", rows, "replace");

    expect(writer.clearForRevision).toHaveBeenCalledWith("rev-T");
    expect(writer.bulkPut).toHaveBeenCalledWith("rev-T", rows);
    expect(writer.clearForRevision.mock.invocationCallOrder[0]).toBeLessThan(
      writer.bulkPut.mock.invocationCallOrder[0] as number,
    );
  });

  it("merge writes the imported rows without clearing", async () => {
    const writer = fakeWriter();
    const rows = [row("a")];
    await applyImportedMarks(writer, "rev-T", rows, "merge");

    expect(writer.clearForRevision).not.toHaveBeenCalled();
    expect(writer.bulkPut).toHaveBeenCalledWith("rev-T", rows);
  });
});
