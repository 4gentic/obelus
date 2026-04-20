import type { PaperCreateInput, PapersRepo } from "../interface";
import type { PaperRow, PaperRubric, RevisionRow } from "../types";
import type { Database } from "./db";
import { dbTxBatch } from "./transaction";

interface PaperSqlRow {
  id: string;
  project_id: string | null;
  title: string;
  entrypoint_rel_path: string | null;
  pdf_rel_path: string | null;
  pdf_sha256: string | null;
  page_count: number | null;
  created_at: string;
  rubric_body: string | null;
  rubric_source: string | null;
  rubric_label: string | null;
  rubric_updated_at: string | null;
}

const SELECT_COLUMNS =
  "id, project_id, title, entrypoint_rel_path, pdf_rel_path, pdf_sha256, page_count, created_at, rubric_body, rubric_source, rubric_label, rubric_updated_at";

function rubricFromRow(r: PaperSqlRow): PaperRubric | undefined {
  if (
    r.rubric_body === null ||
    r.rubric_source === null ||
    r.rubric_label === null ||
    r.rubric_updated_at === null
  ) {
    return undefined;
  }
  if (r.rubric_source !== "file" && r.rubric_source !== "paste" && r.rubric_source !== "inline")
    return undefined;
  return {
    body: r.rubric_body,
    source: r.rubric_source,
    label: r.rubric_label,
    updatedAt: r.rubric_updated_at,
  };
}

function toPaperRow(r: PaperSqlRow): PaperRow {
  const base: PaperRow = {
    id: r.id,
    title: r.title,
    createdAt: r.created_at,
    pdfSha256: r.pdf_sha256 ?? "",
  };
  const projectAdded = r.project_id !== null ? { ...base, projectId: r.project_id } : base;
  const pathAdded =
    r.pdf_rel_path !== null ? { ...projectAdded, pdfRelPath: r.pdf_rel_path } : projectAdded;
  const countAdded = r.page_count !== null ? { ...pathAdded, pageCount: r.page_count } : pathAdded;
  const entryAdded =
    r.entrypoint_rel_path !== null
      ? { ...countAdded, entrypointRelPath: r.entrypoint_rel_path }
      : countAdded;
  const rubric = rubricFromRow(r);
  return rubric !== undefined ? { ...entryAdded, rubric } : entryAdded;
}

function uuid(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

export function buildPapersRepo(db: Database): PapersRepo {
  return {
    async list(): Promise<PaperRow[]> {
      const rows = await db.select<PaperSqlRow[]>(
        `SELECT ${SELECT_COLUMNS}
         FROM papers ORDER BY created_at DESC`,
      );
      return rows.map(toPaperRow);
    },

    async get(id: string): Promise<PaperRow | undefined> {
      const rows = await db.select<PaperSqlRow[]>(
        `SELECT ${SELECT_COLUMNS}
         FROM papers WHERE id = $1`,
        [id],
      );
      const r = rows[0];
      return r ? toPaperRow(r) : undefined;
    },

    async rename(id: string, title: string): Promise<void> {
      await db.execute("UPDATE papers SET title = $1 WHERE id = $2", [title, id]);
    },

    async create(input: PaperCreateInput): Promise<{ paper: PaperRow; revision: RevisionRow }> {
      if (input.source !== "ondisk") {
        throw new Error("sqlite PapersRepo.create requires source: 'ondisk'");
      }
      const createdAt = nowIso();
      const paperId = uuid();
      const revisionId = uuid();
      const paper: PaperRow = {
        id: paperId,
        title: input.title,
        createdAt,
        pdfSha256: input.pdfSha256,
        projectId: input.projectId,
        pdfRelPath: input.pdfRelPath,
        pageCount: input.pageCount,
      };
      const revision: RevisionRow = {
        id: revisionId,
        paperId,
        revisionNumber: 1,
        pdfSha256: input.pdfSha256,
        createdAt,
      };
      await dbTxBatch([
        {
          sql: `INSERT INTO papers (id, project_id, title, pdf_rel_path, pdf_sha256, page_count, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          params: [
            paperId,
            input.projectId,
            input.title,
            input.pdfRelPath,
            input.pdfSha256,
            input.pageCount,
            createdAt,
          ],
        },
        {
          sql: `INSERT INTO revisions (id, paper_id, revision_number, pdf_sha256, created_at)
                VALUES ($1, $2, 1, $3, $4)`,
          params: [revisionId, paperId, input.pdfSha256, createdAt],
        },
      ]);
      return { paper, revision };
    },

    async remove(id: string): Promise<void> {
      // Schema cascades revisions → annotations → write_ups via ON DELETE CASCADE,
      // and nulls ask_threads.paper_id (ON DELETE SET NULL). On-disk PDF files
      // are user-owned and intentionally left in place.
      await db.execute("DELETE FROM papers WHERE id = $1", [id]);
    },

    async setRubric(id: string, rubric: PaperRubric | null): Promise<void> {
      if (rubric === null) {
        await db.execute(
          `UPDATE papers SET rubric_body = NULL, rubric_source = NULL,
                              rubric_label = NULL, rubric_updated_at = NULL
           WHERE id = $1`,
          [id],
        );
        return;
      }
      await db.execute(
        `UPDATE papers SET rubric_body = $1, rubric_source = $2,
                            rubric_label = $3, rubric_updated_at = $4
         WHERE id = $5`,
        [rubric.body, rubric.source, rubric.label, rubric.updatedAt, id],
      );
    },
  };
}
