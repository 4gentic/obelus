import type { PaperEditCreateInput, PaperEditsRepo } from "../interface";
import type { PaperEditKind, PaperEditRow, PaperEditState } from "../types";
import type { Database } from "./db";
import { dbTxBatch, type TxStmt } from "./transaction";

interface PaperEditSqlRow {
  id: string;
  project_id: string;
  paper_id: string;
  parent_edit_id: string | null;
  ordinal: number;
  kind: PaperEditKind;
  session_id: string | null;
  manifest_sha256: string;
  summary: string;
  note_md: string;
  state: PaperEditState;
  created_at: string;
}

function toRow(r: PaperEditSqlRow): PaperEditRow {
  return {
    id: r.id,
    projectId: r.project_id,
    paperId: r.paper_id,
    parentEditId: r.parent_edit_id,
    ordinal: r.ordinal,
    kind: r.kind,
    sessionId: r.session_id,
    manifestSha256: r.manifest_sha256,
    summary: r.summary,
    noteMd: r.note_md,
    state: r.state,
    createdAt: r.created_at,
  };
}

const SELECT_COLS = `id, project_id, paper_id, parent_edit_id, ordinal, kind, session_id,
                     manifest_sha256, summary, note_md, state, created_at`;

function randomUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  throw new Error("crypto.randomUUID unavailable");
}

export function buildPaperEditsRepo(db: Database): PaperEditsRepo {
  return {
    async listForPaper(
      paperId: string,
      opts?: { includeTombstoned?: boolean },
    ): Promise<PaperEditRow[]> {
      const sql = opts?.includeTombstoned
        ? `SELECT ${SELECT_COLS} FROM paper_edits
           WHERE paper_id = $1 ORDER BY ordinal ASC`
        : `SELECT ${SELECT_COLS} FROM paper_edits
           WHERE paper_id = $1 AND state = 'live' ORDER BY ordinal ASC`;
      const rows = await db.select<PaperEditSqlRow[]>(sql, [paperId]);
      return rows.map(toRow);
    },

    async get(id: string): Promise<PaperEditRow | undefined> {
      const rows = await db.select<PaperEditSqlRow[]>(
        `SELECT ${SELECT_COLS} FROM paper_edits WHERE id = $1 LIMIT 1`,
        [id],
      );
      return rows[0] ? toRow(rows[0]) : undefined;
    },

    async head(paperId: string): Promise<PaperEditRow | undefined> {
      const rows = await db.select<PaperEditSqlRow[]>(
        `SELECT ${SELECT_COLS} FROM paper_edits p
         WHERE p.paper_id = $1 AND p.state = 'live'
           AND NOT EXISTS (
             SELECT 1 FROM paper_edits c
             WHERE c.parent_edit_id = p.id AND c.state = 'live'
           )
         ORDER BY ordinal DESC LIMIT 1`,
        [paperId],
      );
      return rows[0] ? toRow(rows[0]) : undefined;
    },

    async baseline(paperId: string): Promise<PaperEditRow | undefined> {
      const rows = await db.select<PaperEditSqlRow[]>(
        `SELECT ${SELECT_COLS} FROM paper_edits
         WHERE paper_id = $1 AND kind = 'baseline'
         ORDER BY ordinal ASC LIMIT 1`,
        [paperId],
      );
      return rows[0] ? toRow(rows[0]) : undefined;
    },

    async create(input: PaperEditCreateInput): Promise<PaperEditRow> {
      const id = randomUuid();
      const createdAt = new Date().toISOString();
      await db.execute(
        `INSERT INTO paper_edits
           (id, project_id, paper_id, parent_edit_id, ordinal, kind, session_id,
            manifest_sha256, summary, note_md, state, created_at)
         VALUES (
           $1, $2, $3, $4,
           (SELECT COALESCE(MAX(ordinal), 0) + 1 FROM paper_edits WHERE paper_id = $3),
           $5, $6, $7, $8, $9, 'live', $10
         )`,
        [
          id,
          input.projectId,
          input.paperId,
          input.parentEditId,
          input.kind,
          input.sessionId,
          input.manifestSha256,
          input.summary,
          input.noteMd ?? "",
          createdAt,
        ],
      );
      const persisted = await this.get(id);
      if (!persisted) throw new Error("paper_edits insert failed to round-trip");
      return persisted;
    },

    async setNote(id: string, noteMd: string): Promise<void> {
      await db.execute(`UPDATE paper_edits SET note_md = $1 WHERE id = $2`, [noteMd, id]);
    },

    async setSummary(id: string, summary: string): Promise<void> {
      await db.execute(`UPDATE paper_edits SET summary = $1 WHERE id = $2`, [summary, id]);
    },

    async tombstoneDescendantsOf(editId: string): Promise<{ tombstoned: string[] }> {
      const toTombstone: string[] = [];
      const frontier: string[] = [editId];
      while (frontier.length > 0) {
        const parent = frontier.shift();
        if (!parent) break;
        const kids = await db.select<{ id: string }[]>(
          `SELECT id FROM paper_edits
           WHERE parent_edit_id = $1 AND state = 'live'`,
          [parent],
        );
        for (const k of kids) {
          toTombstone.push(k.id);
          frontier.push(k.id);
        }
      }
      if (toTombstone.length === 0) return { tombstoned: [] };
      const stmts: TxStmt[] = toTombstone.map((id) => ({
        sql: `UPDATE paper_edits SET state = 'tombstoned' WHERE id = $1`,
        params: [id],
      }));
      await dbTxBatch(stmts);
      return { tombstoned: toTombstone };
    },

    async tombstoneMany(ids: ReadonlyArray<string>): Promise<void> {
      if (ids.length === 0) return;
      const stmts: TxStmt[] = ids.map((id) => ({
        sql: `UPDATE paper_edits SET state = 'tombstoned' WHERE id = $1`,
        params: [id],
      }));
      await dbTxBatch(stmts);
    },

    async restore(id: string): Promise<void> {
      await db.execute(`UPDATE paper_edits SET state = 'live' WHERE id = $1`, [id]);
    },

    async countForPaper(paperId: string, opts?: { includeTombstoned?: boolean }): Promise<number> {
      const sql = opts?.includeTombstoned
        ? `SELECT COUNT(*) AS count FROM paper_edits WHERE paper_id = $1`
        : `SELECT COUNT(*) AS count FROM paper_edits
           WHERE paper_id = $1 AND state = 'live'`;
      const rows = await db.select<{ count: number }[]>(sql, [paperId]);
      return rows[0]?.count ?? 0;
    },
  };
}
