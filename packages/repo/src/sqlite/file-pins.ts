import type { FilePinsRepo } from "../interface";
import type { FilePinRow } from "../types";
import type { Database } from "./db";

interface FilePinSqlRow {
  project_id: string;
  rel_path: string;
  pinned_at: string;
}

function toFilePinRow(row: FilePinSqlRow): FilePinRow {
  return {
    projectId: row.project_id,
    relPath: row.rel_path,
    pinnedAt: row.pinned_at,
  };
}

export function buildFilePinsRepo(db: Database): FilePinsRepo {
  return {
    async listForProject(projectId: string): Promise<FilePinRow[]> {
      const rows = await db.select<FilePinSqlRow[]>(
        `SELECT project_id, rel_path, pinned_at
         FROM file_pins
         WHERE project_id = $1
         ORDER BY pinned_at DESC`,
        [projectId],
      );
      return rows.map(toFilePinRow);
    },

    async pin(projectId: string, relPath: string): Promise<void> {
      await db.execute(
        `INSERT OR IGNORE INTO file_pins (project_id, rel_path, pinned_at)
         VALUES ($1, $2, $3)`,
        [projectId, relPath, new Date().toISOString()],
      );
    },

    async unpin(projectId: string, relPath: string): Promise<void> {
      await db.execute("DELETE FROM file_pins WHERE project_id = $1 AND rel_path = $2", [
        projectId,
        relPath,
      ]);
    },

    async isPinned(projectId: string, relPath: string): Promise<boolean> {
      const rows = await db.select<FilePinSqlRow[]>(
        "SELECT project_id, rel_path, pinned_at FROM file_pins WHERE project_id = $1 AND rel_path = $2",
        [projectId, relPath],
      );
      return rows.length > 0;
    },
  };
}
