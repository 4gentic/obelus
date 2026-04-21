import { describe, expect, it, vi } from "vitest";
import { buildProjectsRepo, toProjectRow } from "../projects";

describe("toProjectRow", () => {
  it("converts snake_case columns to camelCase fields", () => {
    const row = toProjectRow({
      id: "abc",
      label: "Paper",
      kind: "writer",
      root: "/tmp/paper",
      pinned: 1,
      archived: 0,
      last_opened_at: "2025-01-02T03:04:05.000Z",
      last_opened_file_rel_path: "papers/a.pdf",
      created_at: "2025-01-01T00:00:00.000Z",
      desk_id: "desk-1",
    });
    expect(row).toEqual({
      id: "abc",
      label: "Paper",
      kind: "writer",
      root: "/tmp/paper",
      pinned: true,
      archived: false,
      lastOpenedAt: "2025-01-02T03:04:05.000Z",
      lastOpenedFilePath: "papers/a.pdf",
      createdAt: "2025-01-01T00:00:00.000Z",
      deskId: "desk-1",
    });
  });

  it("maps archived=1 → true and null last_opened_at through", () => {
    const row = toProjectRow({
      id: "x",
      label: "L",
      kind: "reviewer",
      root: "/p.pdf",
      pinned: 0,
      archived: 1,
      last_opened_at: null,
      last_opened_file_rel_path: null,
      created_at: "2025-01-01T00:00:00.000Z",
      desk_id: "desk-1",
    });
    expect(row.archived).toBe(true);
    expect(row.pinned).toBe(false);
    expect(row.lastOpenedAt).toBeNull();
    expect(row.lastOpenedFilePath).toBeNull();
  });
});

describe("buildProjectsRepo", () => {
  function mockDb() {
    return {
      select: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
    };
  }

  it("list() issues ORDER BY pinned DESC", async () => {
    const db = mockDb();
    const repo = buildProjectsRepo(db as never);
    await repo.list();
    const sql = db.select.mock.calls[0]?.[0] as string;
    expect(sql).toMatch(/ORDER BY pinned DESC/);
  });

  it("rename() issues an UPDATE with bound params", async () => {
    const db = mockDb();
    const repo = buildProjectsRepo(db as never);
    await repo.rename("id1", "New label");
    expect(db.execute).toHaveBeenCalledWith("UPDATE projects SET label = $1 WHERE id = $2", [
      "New label",
      "id1",
    ]);
  });

  it("forget() issues DELETE", async () => {
    const db = mockDb();
    const repo = buildProjectsRepo(db as never);
    await repo.forget("id1");
    expect(db.execute).toHaveBeenCalledWith("DELETE FROM projects WHERE id = $1", ["id1"]);
  });

  it("create() issues a single INSERT INTO projects", async () => {
    const db = mockDb();
    const repo = buildProjectsRepo(db as never);
    const row = await repo.create({
      label: "P",
      kind: "writer",
      root: "/tmp/p",
      deskId: "desk-1",
    });
    expect(db.execute).toHaveBeenCalledTimes(1);
    const sql = db.execute.mock.calls[0]?.[0] as string;
    expect(sql).toMatch(/INSERT INTO projects/);
    expect(row.label).toBe("P");
    expect(row.kind).toBe("writer");
    expect(row.pinned).toBe(false);
    expect(row.deskId).toBe("desk-1");
    expect(row.lastOpenedFilePath).toBeNull();
  });

  it("setLastOpenedFile() updates the column with the given path", async () => {
    const db = mockDb();
    const repo = buildProjectsRepo(db as never);
    await repo.setLastOpenedFile("id1", "papers/b.pdf");
    expect(db.execute).toHaveBeenCalledWith(
      "UPDATE projects SET last_opened_file_rel_path = $1 WHERE id = $2",
      ["papers/b.pdf", "id1"],
    );
  });

  it("setLastOpenedFile() clears the column when passed null", async () => {
    const db = mockDb();
    const repo = buildProjectsRepo(db as never);
    await repo.setLastOpenedFile("id1", null);
    expect(db.execute).toHaveBeenCalledWith(
      "UPDATE projects SET last_opened_file_rel_path = $1 WHERE id = $2",
      [null, "id1"],
    );
  });
});
