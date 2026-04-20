import type { AnnotationsRepo } from "../interface";
import type { AnnotationRow } from "../types";
import type { Database } from "./db";
import { dbTxBatch, type TxStmt } from "./transaction";

interface AnnotationSqlRow {
  id: string;
  revision_id: string;
  category: string;
  quote: string;
  context_before: string;
  context_after: string;
  anchor_kind: "pdf" | "source" | "html";
  anchor_json: string;
  note: string;
  thread_json: string;
  group_id: string | null;
  created_at: string;
}

interface PdfAnchorJson {
  kind: "pdf";
  page: number;
  bbox: [number, number, number, number];
  rects?: Array<[number, number, number, number]>;
  textItemRange: { start: [number, number]; end: [number, number] };
}

function toAnnotationRow(r: AnnotationSqlRow): AnnotationRow {
  const anchor = JSON.parse(r.anchor_json) as PdfAnchorJson;
  const thread = JSON.parse(r.thread_json) as AnnotationRow["thread"];
  const base: AnnotationRow = {
    id: r.id,
    revisionId: r.revision_id,
    category: r.category,
    quote: r.quote,
    contextBefore: r.context_before,
    contextAfter: r.context_after,
    page: anchor.page,
    bbox: anchor.bbox,
    textItemRange: anchor.textItemRange,
    note: r.note,
    thread,
    createdAt: r.created_at,
  };
  const withRects = anchor.rects !== undefined ? { ...base, rects: anchor.rects } : base;
  return r.group_id !== null ? { ...withRects, groupId: r.group_id } : withRects;
}

function toAnchorJson(row: AnnotationRow): string {
  const anchor: PdfAnchorJson = {
    kind: "pdf",
    page: row.page,
    bbox: row.bbox,
    textItemRange: row.textItemRange,
    ...(row.rects !== undefined ? { rects: row.rects } : {}),
  };
  return JSON.stringify(anchor);
}

export function buildAnnotationsRepo(db: Database): AnnotationsRepo {
  return {
    async listForRevision(revisionId: string): Promise<AnnotationRow[]> {
      const rows = await db.select<AnnotationSqlRow[]>(
        `SELECT id, revision_id, category, quote, context_before, context_after,
                anchor_kind, anchor_json, note, thread_json, group_id, created_at
         FROM annotations WHERE revision_id = $1 ORDER BY created_at ASC`,
        [revisionId],
      );
      return rows.map(toAnnotationRow);
    },

    async bulkPut(revisionId: string, rows: AnnotationRow[]): Promise<void> {
      if (rows.length === 0) return;
      const stmts: TxStmt[] = rows.map((row) => ({
        sql: `INSERT INTO annotations (id, revision_id, category, quote,
                                       context_before, context_after,
                                       anchor_kind, anchor_json,
                                       note, thread_json, group_id, created_at)
              VALUES ($1, $2, $3, $4, $5, $6, 'pdf', $7, $8, $9, $10, $11)
              ON CONFLICT(id) DO UPDATE SET
                category = excluded.category,
                quote = excluded.quote,
                context_before = excluded.context_before,
                context_after = excluded.context_after,
                anchor_kind = excluded.anchor_kind,
                anchor_json = excluded.anchor_json,
                note = excluded.note,
                thread_json = excluded.thread_json,
                group_id = excluded.group_id`,
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
        ],
      }));
      await dbTxBatch(stmts);
    },

    async remove(id: string): Promise<void> {
      await db.execute("DELETE FROM annotations WHERE id = $1", [id]);
    },
  };
}
