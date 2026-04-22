import type { ProjectFilesRepo } from "../interface";
import type { ProjectFileFormat, ProjectFileRole, ProjectFileRow } from "../types";
import type { Database } from "./db";
import { dbTxBatch, type TxStmt } from "./transaction";

interface ProjectFileSqlRow {
  project_id: string;
  rel_path: string;
  format: ProjectFileFormat;
  role: ProjectFileRole | null;
  size: number;
  mtime_ms: number;
  scanned_at: string;
}

function toRow(r: ProjectFileSqlRow): ProjectFileRow {
  return {
    projectId: r.project_id,
    relPath: r.rel_path,
    format: r.format,
    role: r.role,
    size: r.size,
    mtimeMs: r.mtime_ms,
    scannedAt: r.scanned_at,
  };
}

const SELECT_COLS = `project_id, rel_path, format, role, size, mtime_ms, scanned_at`;

export function buildProjectFilesRepo(db: Database): ProjectFilesRepo {
  return {
    async listForProject(
      projectId: string,
      opts?: { format?: ProjectFileFormat },
    ): Promise<ProjectFileRow[]> {
      if (opts?.format) {
        const rows = await db.select<ProjectFileSqlRow[]>(
          `SELECT ${SELECT_COLS} FROM project_files
           WHERE project_id = $1 AND format = $2
           ORDER BY rel_path ASC`,
          [projectId, opts.format],
        );
        return rows.map(toRow);
      }
      const rows = await db.select<ProjectFileSqlRow[]>(
        `SELECT ${SELECT_COLS} FROM project_files
         WHERE project_id = $1
         ORDER BY rel_path ASC`,
        [projectId],
      );
      return rows.map(toRow);
    },

    async replaceAll(projectId: string, rows: ReadonlyArray<ProjectFileRow>): Promise<void> {
      const stmts: TxStmt[] = [
        { sql: `DELETE FROM project_files WHERE project_id = $1`, params: [projectId] },
      ];
      for (const row of rows) {
        stmts.push({
          sql: `INSERT INTO project_files
                  (project_id, rel_path, format, role, size, mtime_ms, scanned_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          params: [
            projectId,
            row.relPath,
            row.format,
            row.role,
            row.size,
            row.mtimeMs,
            row.scannedAt,
          ],
        });
      }
      await dbTxBatch(stmts);
    },
  };
}
