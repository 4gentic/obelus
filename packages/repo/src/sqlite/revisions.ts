import type { RevisionCreateInput, RevisionsRepo } from "../interface";
import type { RevisionRow } from "../types";
import type { Database } from "./db";

interface RevisionSqlRow {
  id: string;
  paper_id: string;
  revision_number: number;
  pdf_sha256: string | null;
  note: string | null;
  created_at: string;
}

interface MaxRow {
  max_number: number | null;
}

function toRevisionRow(r: RevisionSqlRow): RevisionRow {
  const base: RevisionRow = {
    id: r.id,
    paperId: r.paper_id,
    revisionNumber: r.revision_number,
    pdfSha256: r.pdf_sha256 ?? "",
    createdAt: r.created_at,
  };
  return r.note !== null ? { ...base, note: r.note } : base;
}

function uuid(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

export function buildRevisionsRepo(db: Database): RevisionsRepo {
  return {
    async listForPaper(paperId: string): Promise<RevisionRow[]> {
      const rows = await db.select<RevisionSqlRow[]>(
        `SELECT id, paper_id, revision_number, pdf_sha256, note, created_at
         FROM revisions WHERE paper_id = $1 ORDER BY revision_number ASC`,
        [paperId],
      );
      return rows.map(toRevisionRow);
    },

    async get(id: string): Promise<RevisionRow | undefined> {
      const rows = await db.select<RevisionSqlRow[]>(
        `SELECT id, paper_id, revision_number, pdf_sha256, note, created_at
         FROM revisions WHERE id = $1`,
        [id],
      );
      const r = rows[0];
      return r ? toRevisionRow(r) : undefined;
    },

    async createFromPaper(paperId: string, input: RevisionCreateInput): Promise<RevisionRow> {
      if (input.source !== "ondisk") {
        throw new Error("sqlite RevisionsRepo.createFromPaper requires source: 'ondisk'");
      }
      const id = uuid();
      const createdAt = nowIso();
      // Single-writer desktop: a raw MAX read followed by one INSERT is safe.
      // A real transaction would need to span read + write on the same
      // connection, which tauri-plugin-sql's pooled executor can't guarantee.
      const rows = await db.select<MaxRow[]>(
        "SELECT COALESCE(MAX(revision_number), 0) AS max_number FROM revisions WHERE paper_id = $1",
        [paperId],
      );
      const nextNumber = (rows[0]?.max_number ?? 0) + 1;
      await db.execute(
        `INSERT INTO revisions (id, paper_id, revision_number, pdf_sha256, note, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, paperId, nextNumber, input.pdfSha256, input.note ?? null, createdAt],
      );
      const revision: RevisionRow = {
        id,
        paperId,
        revisionNumber: nextNumber,
        pdfSha256: input.pdfSha256,
        createdAt,
        ...(input.note !== undefined ? { note: input.note } : {}),
      };
      return revision;
    },
  };
}
