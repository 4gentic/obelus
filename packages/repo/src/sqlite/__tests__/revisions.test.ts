import { describe, expect, it, vi } from "vitest";
import { buildRevisionsRepo } from "../revisions";

function mockDb(maxNumber: number | null = 0) {
  return {
    select: vi.fn().mockResolvedValue([{ max_number: maxNumber }]),
    execute: vi.fn().mockResolvedValue(undefined),
  };
}

describe("buildRevisionsRepo", () => {
  it("createFromPaper() requires source: 'ondisk'", async () => {
    const db = mockDb();
    const repo = buildRevisionsRepo(db as never);
    await expect(
      repo.createFromPaper("paper-1", {
        source: "bytes",
        pdfBytes: new ArrayBuffer(0),
      }),
    ).rejects.toThrow(/ondisk/);
  });

  it("createFromPaper() computes MAX(revision_number) + 1", async () => {
    const db = mockDb(3);
    const repo = buildRevisionsRepo(db as never);
    const rev = await repo.createFromPaper("paper-1", {
      source: "ondisk",
      pdfRelPath: "v4.pdf",
      pdfSha256: "deadbeef",
      pageCount: 20,
    });
    expect(rev.revisionNumber).toBe(4);
    expect(rev.paperId).toBe("paper-1");
    expect(rev.pdfSha256).toBe("deadbeef");
  });

  it("createFromPaper() starts at 1 when no prior revisions", async () => {
    const db = mockDb(null);
    const repo = buildRevisionsRepo(db as never);
    const rev = await repo.createFromPaper("paper-1", {
      source: "ondisk",
      pdfRelPath: "v1.pdf",
      pdfSha256: "c0ffee",
      pageCount: 8,
    });
    expect(rev.revisionNumber).toBe(1);
  });
});
