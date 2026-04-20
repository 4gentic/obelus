import type { DiffHunksRepo } from "../interface";
import type { DiffHunkRow, DiffHunkState } from "../types";
import type { Database } from "./db";
import { dbTxBatch, type TxStmt } from "./transaction";

interface DiffHunkSqlRow {
  id: string;
  session_id: string;
  annotation_id: string | null;
  file: string;
  category: string | null;
  patch: string;
  modified_patch_text: string | null;
  state: DiffHunkState;
  ambiguous: number;
  note_text: string;
  ordinal: number;
}

function toRow(r: DiffHunkSqlRow): DiffHunkRow {
  return {
    id: r.id,
    sessionId: r.session_id,
    annotationId: r.annotation_id,
    file: r.file,
    category: r.category,
    patch: r.patch,
    modifiedPatchText: r.modified_patch_text,
    state: r.state,
    ambiguous: r.ambiguous === 1,
    noteText: r.note_text,
    ordinal: r.ordinal,
  };
}

const SELECT = `SELECT id, session_id, annotation_id, file, category, patch,
         modified_patch_text, state, ambiguous, note_text, ordinal
  FROM diff_hunks`;

export function buildDiffHunksRepo(db: Database): DiffHunksRepo {
  return {
    async listForSession(sessionId: string): Promise<DiffHunkRow[]> {
      const rows = await db.select<DiffHunkSqlRow[]>(
        `${SELECT} WHERE session_id = $1 ORDER BY ordinal ASC, id ASC`,
        [sessionId],
      );
      return rows.map(toRow);
    },

    async upsertMany(sessionId: string, rows: ReadonlyArray<DiffHunkRow>): Promise<void> {
      const stmts: TxStmt[] = [
        { sql: "DELETE FROM diff_hunks WHERE session_id = $1", params: [sessionId] },
      ];
      for (const r of rows) {
        stmts.push({
          sql: `INSERT INTO diff_hunks
                  (id, session_id, annotation_id, file, category, patch,
                   modified_patch_text, state, ambiguous, note_text, ordinal)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          params: [
            r.id,
            sessionId,
            r.annotationId,
            r.file,
            r.category,
            r.patch,
            r.modifiedPatchText,
            r.state,
            r.ambiguous ? 1 : 0,
            r.noteText,
            r.ordinal,
          ],
        });
      }
      await dbTxBatch(stmts);
    },

    async setState(id: string, state: DiffHunkState): Promise<void> {
      await db.execute("UPDATE diff_hunks SET state = $1 WHERE id = $2", [state, id]);
    },

    async setModifiedPatch(id: string, patch: string): Promise<void> {
      await db.execute(
        `UPDATE diff_hunks SET modified_patch_text = $1, state = 'modified' WHERE id = $2`,
        [patch, id],
      );
    },

    async setNote(id: string, note: string): Promise<void> {
      await db.execute("UPDATE diff_hunks SET note_text = $1 WHERE id = $2", [note, id]);
    },

    async acceptAllInFile(sessionId: string, file: string): Promise<void> {
      await db.execute(
        `UPDATE diff_hunks SET state = 'accepted'
         WHERE session_id = $1 AND file = $2 AND state IN ('pending', 'rejected')`,
        [sessionId, file],
      );
    },

    async countsByState(sessionId: string): Promise<Record<DiffHunkState, number>> {
      const rows = await db.select<{ state: DiffHunkState; count: number }[]>(
        `SELECT state, COUNT(*) AS count FROM diff_hunks
         WHERE session_id = $1 GROUP BY state`,
        [sessionId],
      );
      const counts: Record<DiffHunkState, number> = {
        pending: 0,
        accepted: 0,
        rejected: 0,
        modified: 0,
      };
      for (const r of rows) counts[r.state] = r.count;
      return counts;
    },
  };
}
