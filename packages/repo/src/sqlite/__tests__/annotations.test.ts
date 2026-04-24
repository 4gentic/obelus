import { describe, expect, it, vi } from "vitest";
import type { AnnotationRow } from "../../types";
import { buildAnnotationsRepo } from "../annotations";

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

function makeRow(overrides: Partial<AnnotationRow> = {}): AnnotationRow {
  return {
    id: "a1",
    revisionId: "rev-1",
    category: "unclear",
    quote: "the thing",
    contextBefore: "",
    contextAfter: "",
    page: 1,
    bbox: [0, 0, 100, 20],
    textItemRange: { start: [0, 0], end: [0, 9] },
    note: "",
    thread: [],
    createdAt: "2026-04-19T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildAnnotationsRepo", () => {
  it("bulkPut() with empty rows is a no-op", async () => {
    invokeMock.mockClear();
    const db = mockDb();
    const repo = buildAnnotationsRepo(db as never);
    await repo.bulkPut("rev-1", []);
    expect(db.execute).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("bulkPut() runs INSERTs via db_tx_batch and serializes anchor_json", async () => {
    invokeMock.mockClear();
    const db = mockDb();
    const repo = buildAnnotationsRepo(db as never);
    await repo.bulkPut("rev-1", [makeRow({ rects: [[0, 0, 50, 10]] })]);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = invokeMock.mock.calls[0] as [
      string,
      { stmts: { sql: string; params: unknown[] }[] },
    ];
    expect(cmd).toBe("db_tx_batch");
    const stmt = args.stmts[0];
    expect(stmt?.sql).toMatch(/INSERT INTO annotations/);
    expect(stmt?.sql).toMatch(/ON CONFLICT\(id\) DO UPDATE/);
    const anchor = JSON.parse(stmt?.params[6] as string) as { kind: string; rects?: unknown };
    expect(anchor.kind).toBe("pdf");
    expect(anchor.rects).toEqual([[0, 0, 50, 10]]);
  });

  it("remove() issues DELETE by id", async () => {
    const db = mockDb();
    const repo = buildAnnotationsRepo(db as never);
    await repo.remove("a1");
    expect(db.execute).toHaveBeenCalledWith("DELETE FROM annotations WHERE id = $1", ["a1"]);
  });

  it("bulkPut() writes staleness as the last parameter (null when unset)", async () => {
    invokeMock.mockClear();
    const db = mockDb();
    const repo = buildAnnotationsRepo(db as never);
    await repo.bulkPut("rev-1", [makeRow()]);
    const [, args] = invokeMock.mock.calls[0] as [
      string,
      { stmts: { sql: string; params: unknown[] }[] },
    ];
    const stmt = args.stmts[0];
    expect(stmt?.sql).toMatch(/staleness/);
    expect(stmt?.params[11]).toBeNull();
  });

  it("bulkPut() persists an explicit staleness value", async () => {
    invokeMock.mockClear();
    const db = mockDb();
    const repo = buildAnnotationsRepo(db as never);
    await repo.bulkPut("rev-1", [makeRow({ staleness: "quote-mismatch" })]);
    const [, args] = invokeMock.mock.calls[0] as [
      string,
      { stmts: { sql: string; params: unknown[] }[] },
    ];
    expect(args.stmts[0]?.params[11]).toBe("quote-mismatch");
  });

  it("setStaleness() issues one UPDATE per patch via db_tx_batch", async () => {
    invokeMock.mockClear();
    const db = mockDb();
    const repo = buildAnnotationsRepo(db as never);
    await repo.setStaleness([
      { id: "a1", staleness: "quote-mismatch" },
      { id: "a2", staleness: "ok" },
    ]);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = invokeMock.mock.calls[0] as [
      string,
      { stmts: { sql: string; params: unknown[] }[] },
    ];
    expect(cmd).toBe("db_tx_batch");
    expect(args.stmts).toHaveLength(2);
    expect(args.stmts[0]?.sql).toMatch(/UPDATE annotations SET staleness/);
    expect(args.stmts[0]?.params).toEqual(["quote-mismatch", "a1"]);
  });

  it("setStaleness() with empty patches is a no-op", async () => {
    invokeMock.mockClear();
    const db = mockDb();
    const repo = buildAnnotationsRepo(db as never);
    await repo.setStaleness([]);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("listForRevision() hydrates staleness from the column", async () => {
    const db = mockDb();
    db.select.mockResolvedValueOnce([
      {
        id: "a1",
        revision_id: "rev-1",
        category: "unclear",
        quote: "q",
        context_before: "",
        context_after: "",
        anchor_json: JSON.stringify({
          kind: "source",
          file: "paper.md",
          lineStart: 1,
          colStart: 0,
          lineEnd: 1,
          colEnd: 5,
        }),
        note: "",
        thread_json: "[]",
        group_id: null,
        created_at: "2026-04-19T00:00:00.000Z",
        resolved_in_edit_id: null,
        staleness: "line-out-of-range",
      },
    ]);
    const repo = buildAnnotationsRepo(db as never);
    const rows = await repo.listForRevision("rev-1");
    expect(rows[0]?.staleness).toBe("line-out-of-range");
  });
});
