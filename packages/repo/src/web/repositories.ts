import type { PaperCreateInput, RevisionCreateInput } from "../interface";
import type { PaperRubric } from "../types";
import { deletePdf, putPdf } from "./opfs";
import { requestPersistOnce } from "./persist";
import { type AnnotationRow, getDb, type PaperRow, type RevisionRow } from "./schema";

function uuid(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

export const papers = {
  async list(): Promise<PaperRow[]> {
    return getDb().papers.orderBy("createdAt").reverse().toArray();
  },

  async get(id: string): Promise<PaperRow | undefined> {
    return getDb().papers.get(id);
  },

  async rename(id: string, title: string): Promise<void> {
    const next = title.trim() || "Untitled";
    await getDb().papers.update(id, { title: next });
  },

  async create(input: PaperCreateInput): Promise<{ paper: PaperRow; revision: RevisionRow }> {
    if (input.source !== "bytes") {
      throw new Error("web PapersRepo.create requires source: 'bytes'");
    }
    await requestPersistOnce();
    const pdfSha256 = await putPdf(input.pdfBytes);
    const createdAt = nowIso();
    const paper: PaperRow = { id: uuid(), title: input.title, createdAt, pdfSha256 };
    const revision: RevisionRow = {
      id: uuid(),
      paperId: paper.id,
      revisionNumber: 1,
      pdfSha256,
      createdAt,
    };
    const db = getDb();
    await db.transaction("rw", db.papers, db.revisions, async () => {
      await db.papers.add(paper);
      await db.revisions.add(revision);
    });
    return { paper, revision };
  },

  async setRubric(id: string, rubric: PaperRubric | null): Promise<void> {
    await requestPersistOnce();
    const db = getDb();
    if (rubric === null) {
      const row = await db.papers.get(id);
      if (!row) return;
      const { rubric: _drop, ...rest } = row;
      await db.papers.put(rest);
      return;
    }
    await db.papers.update(id, { rubric });
  },

  async remove(id: string): Promise<void> {
    const db = getDb();
    const revs = await db.revisions.where("paperId").equals(id).toArray();
    const sha256s = Array.from(new Set(revs.map((r) => r.pdfSha256)));
    const revIds = revs.map((r) => r.id);
    await db.transaction("rw", db.papers, db.revisions, db.annotations, async () => {
      if (revIds.length > 0) {
        await db.annotations.where("revisionId").anyOf(revIds).delete();
        await db.revisions.bulkDelete(revIds);
      }
      await db.papers.delete(id);
    });
    // Drop OPFS blobs only if no surviving revision still references them.
    for (const sha256 of sha256s) {
      const stillReferenced = await db.revisions.where("pdfSha256").equals(sha256).first();
      if (!stillReferenced) await deletePdf(sha256);
    }
  },
};

export const revisions = {
  async listForPaper(paperId: string): Promise<RevisionRow[]> {
    return getDb().revisions.where("paperId").equals(paperId).sortBy("revisionNumber");
  },

  async get(id: string): Promise<RevisionRow | undefined> {
    return getDb().revisions.get(id);
  },

  async createFromPaper(paperId: string, input: RevisionCreateInput): Promise<RevisionRow> {
    if (input.source !== "bytes") {
      throw new Error("web RevisionsRepo.createFromPaper requires source: 'bytes'");
    }
    await requestPersistOnce();
    const pdfSha256 = await putPdf(input.pdfBytes);
    const db = getDb();
    const existing = await db.revisions.where("paperId").equals(paperId).toArray();
    const next = existing.reduce((max, r) => Math.max(max, r.revisionNumber), 0) + 1;
    const revision: RevisionRow = {
      id: uuid(),
      paperId,
      revisionNumber: next,
      pdfSha256,
      createdAt: nowIso(),
      ...(input.note !== undefined ? { note: input.note } : {}),
    };
    await db.revisions.add(revision);
    return revision;
  },
};

export const annotations = {
  async listForRevision(revisionId: string): Promise<AnnotationRow[]> {
    return getDb().annotations.where("revisionId").equals(revisionId).sortBy("createdAt");
  },

  async bulkPut(revisionId: string, rows: AnnotationRow[]): Promise<void> {
    const stamped = rows.map((r) => ({ ...r, revisionId }));
    await getDb().annotations.bulkPut(stamped);
  },

  async remove(id: string): Promise<void> {
    await getDb().annotations.delete(id);
  },
};

export const settings = {
  async get<T>(key: string): Promise<T | undefined> {
    const row = await getDb().settings.get(key);
    return row ? (row.value as T) : undefined;
  },

  async set<T>(key: string, value: T): Promise<void> {
    await getDb().settings.put({ key, value });
  },
};
