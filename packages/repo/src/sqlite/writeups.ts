import type { WriteUpsRepo } from "../interface";
import type { WriteUpRow } from "../types";
import type { Database } from "./db";

interface WriteUpSqlRow {
  id: string;
  project_id: string;
  paper_id: string;
  body_md: string;
  updated_at: string;
}

function toRow(r: WriteUpSqlRow): WriteUpRow {
  return {
    id: r.id,
    projectId: r.project_id,
    paperId: r.paper_id,
    bodyMd: r.body_md,
    updatedAt: r.updated_at,
  };
}

const SELECT = "SELECT id, project_id, paper_id, body_md, updated_at FROM writeups";

export function buildWriteUpsRepo(db: Database): WriteUpsRepo {
  return {
    async listForProject(projectId: string): Promise<WriteUpRow[]> {
      const rows = await db.select<WriteUpSqlRow[]>(
        `${SELECT} WHERE project_id = $1 ORDER BY updated_at DESC`,
        [projectId],
      );
      return rows.map(toRow);
    },

    async getForPaper(projectId: string, paperId: string): Promise<WriteUpRow | undefined> {
      const rows = await db.select<WriteUpSqlRow[]>(
        `${SELECT} WHERE project_id = $1 AND paper_id = $2 LIMIT 1`,
        [projectId, paperId],
      );
      const found = rows[0];
      return found ? toRow(found) : undefined;
    },

    async upsert(input: {
      projectId: string;
      paperId: string;
      bodyMd: string;
    }): Promise<WriteUpRow> {
      const updatedAt = new Date().toISOString();
      const existingRows = await db.select<WriteUpSqlRow[]>(
        `${SELECT} WHERE project_id = $1 AND paper_id = $2 LIMIT 1`,
        [input.projectId, input.paperId],
      );
      const existing = existingRows[0];
      if (existing) {
        await db.execute("UPDATE writeups SET body_md = $1, updated_at = $2 WHERE id = $3", [
          input.bodyMd,
          updatedAt,
          existing.id,
        ]);
        return {
          id: existing.id,
          projectId: input.projectId,
          paperId: input.paperId,
          bodyMd: input.bodyMd,
          updatedAt,
        };
      }
      const id = crypto.randomUUID();
      await db.execute(
        `INSERT INTO writeups (id, project_id, paper_id, body_md, updated_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, input.projectId, input.paperId, input.bodyMd, updatedAt],
      );
      return {
        id,
        projectId: input.projectId,
        paperId: input.paperId,
        bodyMd: input.bodyMd,
        updatedAt,
      };
    },
  };
}
