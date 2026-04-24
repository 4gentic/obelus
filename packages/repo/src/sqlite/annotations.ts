import { PdfAnchor, SourceAnchor } from "@obelus/bundle-schema";
import { z } from "zod";
import type { AnnotationStalenessPatch, AnnotationsRepo } from "../interface";
import type { AnchorFields, AnnotationRow, AnnotationStaleness } from "../types";
import type { Database } from "./db";
import { dbTxBatch, type TxStmt } from "./transaction";

interface AnnotationSqlRow {
  id: string;
  revision_id: string;
  category: string;
  quote: string;
  context_before: string;
  context_after: string;
  anchor_json: string;
  note: string;
  thread_json: string;
  group_id: string | null;
  created_at: string;
  resolved_in_edit_id: string | null;
  staleness: string | null;
}

function isStaleness(value: string): value is AnnotationStaleness {
  return value === "ok" || value === "line-out-of-range" || value === "quote-mismatch";
}

// Row-shape Zod that extends bundle-schema's PdfAnchor with the optional `rects`
// cache — a UI-only field the canonical wire schema deliberately omits.
const Bbox4 = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const PdfAnchorRow = PdfAnchor.extend({
  rects: z.array(Bbox4).optional(),
});
const RowAnchor = z.discriminatedUnion("kind", [PdfAnchorRow, SourceAnchor]);
const ThreadEntries = z.array(z.object({ at: z.string(), body: z.string() }));

function toAnnotationRow(r: AnnotationSqlRow): AnnotationRow {
  const anchor = RowAnchor.parse(JSON.parse(r.anchor_json)) as AnchorFields;
  const thread = ThreadEntries.parse(JSON.parse(r.thread_json));
  const base: AnnotationRow = {
    id: r.id,
    revisionId: r.revision_id,
    category: r.category,
    quote: r.quote,
    contextBefore: r.context_before,
    contextAfter: r.context_after,
    anchor,
    note: r.note,
    thread,
    createdAt: r.created_at,
  };
  const withGroup = r.group_id !== null ? { ...base, groupId: r.group_id } : base;
  const withResolved =
    r.resolved_in_edit_id !== null
      ? { ...withGroup, resolvedInEditId: r.resolved_in_edit_id }
      : withGroup;
  return r.staleness !== null && isStaleness(r.staleness)
    ? { ...withResolved, staleness: r.staleness }
    : withResolved;
}

function toAnchorJson(row: AnnotationRow): string {
  return JSON.stringify(row.anchor);
}

export function buildAnnotationsRepo(db: Database): AnnotationsRepo {
  const SELECT_COLS = `id, revision_id, category, quote, context_before, context_after,
                       anchor_json, note, thread_json, group_id, created_at,
                       resolved_in_edit_id, staleness`;
  return {
    async listForRevision(
      revisionId: string,
      opts?: { includeResolved?: boolean; visibleFromEditId?: string },
    ): Promise<AnnotationRow[]> {
      if (opts?.includeResolved) {
        const rows = await db.select<AnnotationSqlRow[]>(
          `SELECT ${SELECT_COLS} FROM annotations WHERE revision_id = $1
           ORDER BY created_at ASC`,
          [revisionId],
        );
        return rows.map(toAnnotationRow);
      }
      // Ancestry-scoped resolution: a mark is "resolved" only when its fix
      // landed in an edit that's part of the currently-viewed draft's history.
      // Reverting to an older draft un-hides marks that were resolved in the
      // forward branches the user stepped off.
      if (opts?.visibleFromEditId !== undefined) {
        const rows = await db.select<AnnotationSqlRow[]>(
          `WITH RECURSIVE ancestors(id) AS (
             SELECT id FROM paper_edits WHERE id = $2
             UNION
             SELECT p.parent_edit_id FROM paper_edits p
               JOIN ancestors a ON p.id = a.id
               WHERE p.parent_edit_id IS NOT NULL
           )
           SELECT ${SELECT_COLS} FROM annotations
           WHERE revision_id = $1
             AND (resolved_in_edit_id IS NULL
                  OR resolved_in_edit_id NOT IN (SELECT id FROM ancestors))
           ORDER BY created_at ASC`,
          [revisionId, opts.visibleFromEditId],
        );
        return rows.map(toAnnotationRow);
      }
      const rows = await db.select<AnnotationSqlRow[]>(
        `SELECT ${SELECT_COLS} FROM annotations
         WHERE revision_id = $1 AND resolved_in_edit_id IS NULL
         ORDER BY created_at ASC`,
        [revisionId],
      );
      return rows.map(toAnnotationRow);
    },

    async bulkPut(revisionId: string, rows: AnnotationRow[]): Promise<void> {
      if (rows.length === 0) return;
      const stmts: TxStmt[] = rows.map((row) => ({
        sql: `INSERT INTO annotations (id, revision_id, category, quote,
                                       context_before, context_after,
                                       anchor_json,
                                       note, thread_json, group_id, created_at,
                                       staleness)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
              ON CONFLICT(id) DO UPDATE SET
                category = excluded.category,
                quote = excluded.quote,
                context_before = excluded.context_before,
                context_after = excluded.context_after,
                anchor_json = excluded.anchor_json,
                note = excluded.note,
                thread_json = excluded.thread_json,
                group_id = excluded.group_id,
                staleness = excluded.staleness`,
        params: [
          row.id,
          revisionId,
          row.category,
          row.quote,
          row.contextBefore,
          row.contextAfter,
          toAnchorJson(row),
          row.note,
          JSON.stringify(row.thread),
          row.groupId ?? null,
          row.createdAt,
          row.staleness ?? null,
        ],
      }));
      try {
        await dbTxBatch(stmts);
      } catch (err) {
        console.warn("[persist-mark]", {
          outcome: "bulkput-threw",
          revisionId,
          rowCount: rows.length,
          ids: rows.map((r) => r.id),
          detail: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
      console.info("[persist-mark]", {
        outcome: "committed",
        revisionId,
        rowCount: rows.length,
        ids: rows.map((r) => r.id),
        kind: rows[0]?.anchor.kind,
      });
    },

    async remove(id: string): Promise<void> {
      await db.execute("DELETE FROM annotations WHERE id = $1", [id]);
    },

    async markResolvedInEdit(ids: ReadonlyArray<string>, editId: string): Promise<void> {
      if (ids.length === 0) return;
      const stmts: TxStmt[] = ids.map((id) => ({
        sql: `UPDATE annotations SET resolved_in_edit_id = $1 WHERE id = $2`,
        params: [editId, id],
      }));
      await dbTxBatch(stmts);
    },

    async setStaleness(patches: ReadonlyArray<AnnotationStalenessPatch>): Promise<void> {
      if (patches.length === 0) return;
      const stmts: TxStmt[] = patches.map((p) => ({
        sql: `UPDATE annotations SET staleness = $1 WHERE id = $2`,
        params: [p.staleness, p.id],
      }));
      await dbTxBatch(stmts);
    },
  };
}
