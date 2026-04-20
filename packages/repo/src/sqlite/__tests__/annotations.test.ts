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
});
