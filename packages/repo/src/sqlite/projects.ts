import type { ProjectCreateInput, ProjectsRepo } from "../interface";
import type { ProjectKind, ProjectRow } from "../types";
import type { Database } from "./db";

export interface ProjectSqlRow {
  id: string;
  label: string;
  kind: ProjectKind;
  root: string;
  pinned: number;
  archived: number;
  last_opened_at: string | null;
  last_opened_file_rel_path: string | null;
  created_at: string;
  desk_id: string;
}

const SELECT_COLUMNS =
  "id, label, kind, root, pinned, archived, last_opened_at, last_opened_file_rel_path, created_at, desk_id";

export function toProjectRow(row: ProjectSqlRow): ProjectRow {
  return {
    id: row.id,
    label: row.label,
    kind: row.kind,
    root: row.root,
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    lastOpenedAt: row.last_opened_at,
    lastOpenedFilePath: row.last_opened_file_rel_path,
    createdAt: row.created_at,
    deskId: row.desk_id,
  };
}

export function buildProjectsRepo(db: Database): ProjectsRepo {
  return {
    async list(deskId?: string): Promise<ProjectRow[]> {
      const rows = deskId
        ? await db.select<ProjectSqlRow[]>(
            `SELECT ${SELECT_COLUMNS}
             FROM projects
             WHERE desk_id = $1
             ORDER BY pinned DESC, COALESCE(last_opened_at, created_at) DESC`,
            [deskId],
          )
        : await db.select<ProjectSqlRow[]>(
            `SELECT ${SELECT_COLUMNS}
             FROM projects
             ORDER BY pinned DESC, COALESCE(last_opened_at, created_at) DESC`,
          );
      return rows.map(toProjectRow);
    },

    async get(id): Promise<ProjectRow | undefined> {
      const rows = await db.select<ProjectSqlRow[]>(
        `SELECT ${SELECT_COLUMNS}
         FROM projects WHERE id = $1`,
        [id],
      );
      const row = rows[0];
      return row ? toProjectRow(row) : undefined;
    },

    async create(input: ProjectCreateInput): Promise<ProjectRow> {
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      await db.execute(
        `INSERT INTO projects (id, label, kind, root, pinned, archived, last_opened_at, last_opened_file_rel_path, created_at, desk_id)
         VALUES ($1, $2, $3, $4, 0, 0, $5, NULL, $5, $6)`,
        [id, input.label, input.kind, input.root, createdAt, input.deskId],
      );
      return {
        id,
        label: input.label,
        kind: input.kind,
        root: input.root,
        pinned: false,
        archived: false,
        lastOpenedAt: createdAt,
        lastOpenedFilePath: null,
        createdAt,
        deskId: input.deskId,
      };
    },

    async rename(id: string, label: string): Promise<void> {
      await db.execute("UPDATE projects SET label = $1 WHERE id = $2", [label, id]);
    },

    async setPinned(id: string, pinned: boolean): Promise<void> {
      await db.execute("UPDATE projects SET pinned = $1 WHERE id = $2", [pinned ? 1 : 0, id]);
    },

    async forget(id: string): Promise<void> {
      await db.execute("DELETE FROM projects WHERE id = $1", [id]);
    },

    async repoint(id: string, newRoot: string): Promise<void> {
      await db.execute("UPDATE projects SET root = $1 WHERE id = $2", [newRoot, id]);
    },

    async moveToDesk(id: string, deskId: string): Promise<void> {
      await db.execute("UPDATE projects SET desk_id = $1 WHERE id = $2", [deskId, id]);
    },

    async touchLastOpened(id: string): Promise<void> {
      await db.execute("UPDATE projects SET last_opened_at = $1 WHERE id = $2", [
        new Date().toISOString(),
        id,
      ]);
    },

    async setLastOpenedFile(id: string, path: string | null): Promise<void> {
      await db.execute("UPDATE projects SET last_opened_file_rel_path = $1 WHERE id = $2", [
        path,
        id,
      ]);
    },
  };
}
