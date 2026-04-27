import { z } from "zod";
import type { DiffHunksRepo } from "../interface";
import type {
  DiffHunkApplyFailure,
  DiffHunkEmptyReason,
  DiffHunkRow,
  DiffHunkState,
} from "../types";
import type { Database } from "./db";
import { dbTxBatch, type TxStmt } from "./transaction";

const DiffHunkApplyFailureSchema = z.object({
  reason: z.string(),
  attemptedAt: z.string(),
});

const EMPTY_REASONS = new Set<DiffHunkEmptyReason>([
  "praise",
  "ambiguous",
  "structural-note",
  "no-edit-requested",
]);

interface DiffHunkSqlRow {
  id: string;
  session_id: string;
  annotation_ids_json: string;
  file: string;
  category: string | null;
  patch: string;
  modified_patch_text: string | null;
  state: DiffHunkState;
  ambiguous: number;
  empty_reason: string | null;
  note_text: string;
  reviewer_notes: string;
  ordinal: number;
  apply_failure_json: string | null;
}

function parseApplyFailure(raw: string | null): DiffHunkApplyFailure | null {
  if (raw === null || raw === "") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = DiffHunkApplyFailureSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function parseAnnotationIds(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

function parseEmptyReason(raw: string | null): DiffHunkEmptyReason | null {
  if (raw === null) return null;
  return EMPTY_REASONS.has(raw as DiffHunkEmptyReason) ? (raw as DiffHunkEmptyReason) : null;
}

function toRow(r: DiffHunkSqlRow): DiffHunkRow {
  return {
    id: r.id,
    sessionId: r.session_id,
    annotationIds: parseAnnotationIds(r.annotation_ids_json),
    file: r.file,
    category: r.category,
    patch: r.patch,
    modifiedPatchText: r.modified_patch_text,
    state: r.state,
    ambiguous: r.ambiguous === 1,
    emptyReason: parseEmptyReason(r.empty_reason),
    noteText: r.note_text,
    reviewerNotes: r.reviewer_notes,
    ordinal: r.ordinal,
    applyFailure: parseApplyFailure(r.apply_failure_json),
  };
}

const SELECT = `SELECT id, session_id, annotation_ids_json, file, category, patch,
         modified_patch_text, state, ambiguous, empty_reason, note_text,
         reviewer_notes, ordinal, apply_failure_json
  FROM diff_hunks`;

function insertStmt(sessionId: string, r: DiffHunkRow): TxStmt {
  return {
    sql: `INSERT INTO diff_hunks
            (id, session_id, annotation_ids_json, file, category, patch,
             modified_patch_text, state, ambiguous, empty_reason, note_text,
             reviewer_notes, ordinal, apply_failure_json)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    params: [
      r.id,
      sessionId,
      JSON.stringify(r.annotationIds),
      r.file,
      r.category,
      r.patch,
      r.modifiedPatchText,
      r.state,
      r.ambiguous ? 1 : 0,
      r.emptyReason,
      r.noteText,
      r.reviewerNotes,
      r.ordinal,
      r.applyFailure === null ? null : JSON.stringify(r.applyFailure),
    ],
  };
}

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
        stmts.push(insertStmt(sessionId, r));
      }
      await dbTxBatch(stmts);
    },

    async appendMany(sessionId: string, rows: ReadonlyArray<DiffHunkRow>): Promise<void> {
      if (rows.length === 0) return;
      const stmts: TxStmt[] = rows.map((r) => insertStmt(sessionId, r));
      await dbTxBatch(stmts);
    },

    async deleteDeepReviewBlocks(sessionId: string): Promise<void> {
      await db.execute(
        `DELETE FROM diff_hunks
           WHERE session_id = $1
             AND json_extract(annotation_ids_json, '$[0]') LIKE 'quality-%'`,
        [sessionId],
      );
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
      // Bulk ops skip informational hunks (patch === ''): they have no apply
      // path, and flipping their state would desync the apply-gate counts.
      await db.execute(
        `UPDATE diff_hunks SET state = 'accepted'
         WHERE session_id = $1 AND file = $2 AND patch != ''
           AND state IN ('pending', 'rejected')`,
        [sessionId, file],
      );
    },

    async acceptAllInSession(sessionId: string): Promise<void> {
      await db.execute(
        `UPDATE diff_hunks SET state = 'accepted'
         WHERE session_id = $1 AND patch != '' AND state IN ('pending', 'rejected')`,
        [sessionId],
      );
    },

    async rejectAllInSession(sessionId: string): Promise<void> {
      await db.execute(
        `UPDATE diff_hunks SET state = 'rejected'
         WHERE session_id = $1 AND patch != '' AND state IN ('pending', 'accepted')`,
        [sessionId],
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

    async setApplyFailure(id: string, failure: DiffHunkApplyFailure | null): Promise<void> {
      await db.execute("UPDATE diff_hunks SET apply_failure_json = $1 WHERE id = $2", [
        failure === null ? null : JSON.stringify(failure),
        id,
      ]);
    },

    async clearApplyFailures(sessionId: string): Promise<void> {
      await db.execute("UPDATE diff_hunks SET apply_failure_json = NULL WHERE session_id = $1", [
        sessionId,
      ]);
    },
  };
}
