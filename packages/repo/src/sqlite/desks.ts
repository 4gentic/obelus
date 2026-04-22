import type { DeskCreateInput, DesksRepo } from "../interface";
import type { DeskRow } from "../types";
import type { Database } from "./db";

export interface DeskSqlRow {
  id: string;
  name: string;
  last_opened_at: string | null;
  created_at: string;
  sort_order: number;
}

export function toDeskRow(row: DeskSqlRow): DeskRow {
  return {
    id: row.id,
    name: row.name,
    lastOpenedAt: row.last_opened_at,
    createdAt: row.created_at,
    sortOrder: row.sort_order,
  };
}

export function buildDesksRepo(db: Database): DesksRepo {
  return {
    async list(): Promise<DeskRow[]> {
      const rows = await db.select<DeskSqlRow[]>(
        `SELECT id, name, last_opened_at, created_at, sort_order
         FROM desks
         ORDER BY sort_order ASC, created_at ASC`,
      );
      return rows.map(toDeskRow);
    },

    async get(id: string): Promise<DeskRow | undefined> {
      const rows = await db.select<DeskSqlRow[]>(
        `SELECT id, name, last_opened_at, created_at, sort_order
         FROM desks WHERE id = $1`,
        [id],
      );
      const row = rows[0];
      return row ? toDeskRow(row) : undefined;
    },

    async create(input: DeskCreateInput): Promise<DeskRow> {
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const orderRows = await db.select<{ next_order: number }[]>(
        "SELECT COALESCE(MAX(sort_order) + 1, 0) AS next_order FROM desks",
      );
      const sortOrder = orderRows[0]?.next_order ?? 0;
      await db.execute(
        `INSERT INTO desks (id, name, last_opened_at, created_at, sort_order)
         VALUES ($1, $2, $3, $3, $4)`,
        [id, input.name, createdAt, sortOrder],
      );
      return {
        id,
        name: input.name,
        lastOpenedAt: createdAt,
        createdAt,
        sortOrder,
      };
    },

    async rename(id: string, name: string): Promise<void> {
      await db.execute("UPDATE desks SET name = $1 WHERE id = $2", [name, id]);
    },

    async remove(id: string): Promise<void> {
      const rows = await db.select<{ count: number }[]>(
        "SELECT COUNT(*) AS count FROM projects WHERE desk_id = $1",
        [id],
      );
      if ((rows[0]?.count ?? 0) > 0) {
        throw new Error("cannot remove desk: it still has projects");
      }
      await db.execute("DELETE FROM desks WHERE id = $1", [id]);
    },

    async touchLastOpened(id: string): Promise<void> {
      await db.execute("UPDATE desks SET last_opened_at = $1 WHERE id = $2", [
        new Date().toISOString(),
        id,
      ]);
    },
  };
}
