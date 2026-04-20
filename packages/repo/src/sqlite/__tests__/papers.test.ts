import { describe, expect, it, vi } from "vitest";
import { buildPapersRepo } from "../papers";

const invokeMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: unknown) => invokeMock(cmd, args),
}));

function mockDb() {
  return {
    select: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(undefined),
  };
}

describe("buildPapersRepo", () => {
  it("list() orders by created_at DESC", async () => {
    const db = mockDb();
    const repo = buildPapersRepo(db as never);
    await repo.list();
    const sql = db.select.mock.calls[0]?.[0] as string;
    expect(sql).toMatch(/ORDER BY created_at DESC/);
  });

  it("create() requires source: 'ondisk'", async () => {
    const db = mockDb();
    const repo = buildPapersRepo(db as never);
    await expect(
      repo.create({
        source: "bytes",
        title: "x",
        pdfBytes: new ArrayBuffer(0),
      }),
    ).rejects.toThrow(/ondisk/);
  });

  it("create() inserts paper + initial revision via db_tx_batch", async () => {
    invokeMock.mockClear();
    const db = mockDb();
    const repo = buildPapersRepo(db as never);
    const { paper, revision } = await repo.create({
      source: "ondisk",
      title: "Paper Title",
      projectId: "project-1",
      pdfRelPath: "main.pdf",
      pdfSha256: "abc123",
      pageCount: 12,
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = invokeMock.mock.calls[0] as [string, { stmts: { sql: string }[] }];
    expect(cmd).toBe("db_tx_batch");
    expect(args.stmts[0]?.sql).toMatch(/INSERT INTO papers/);
    expect(args.stmts[1]?.sql).toMatch(/INSERT INTO revisions/);
    expect(paper.projectId).toBe("project-1");
    expect(paper.pdfRelPath).toBe("main.pdf");
    expect(paper.pdfSha256).toBe("abc123");
    expect(paper.pageCount).toBe(12);
    expect(revision.revisionNumber).toBe(1);
    expect(revision.paperId).toBe(paper.id);
  });
});
