import type {
  AnnotationStalenessPatch,
  PaperCreateInput,
  PaperPathsPatch,
  RevisionCreateInput,
} from "../interface";
import type { PaperRubric } from "../types";
import { deleteMd, deletePdf, putMd, putPdf } from "./opfs";
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
    if (input.source === "ondisk") {
      throw new Error("web PapersRepo.create does not support source: 'ondisk'");
    }
    await requestPersistOnce();
    const createdAt = nowIso();
    const contentSha256 =
      input.source === "md" ? await putMd(input.mdText) : await putPdf(input.pdfBytes);
    const entrypointRelPath = input.source === "md" ? input.file : undefined;
    const format = input.source === "md" ? "md" : (input.format ?? "pdf");
    const paper: PaperRow = {
      id: uuid(),
      title: input.title,
      createdAt,
      format,
      pdfSha256: contentSha256,
      ...(entrypointRelPath !== undefined ? { entrypointRelPath } : {}),
    };
    const revision: RevisionRow = {
      id: uuid(),
      paperId: paper.id,
      revisionNumber: 1,
      pdfSha256: contentSha256,
      createdAt,
    };
    const db = getDb();
    await db.transaction("rw", db.papers, db.revisions, async () => {
      await db.papers.add(paper);
      await db.revisions.add(revision);
    });
    return { paper, revision };
  },

  async setPaths(id: string, patch: PaperPathsPatch): Promise<void> {
    const db = getDb();
    const row = await db.papers.get(id);
    if (!row) return;
    const next = { ...row };
    if ("pdfRelPath" in patch) {
      if (patch.pdfRelPath) next.pdfRelPath = patch.pdfRelPath;
      else delete next.pdfRelPath;
    }
    if ("entrypointRelPath" in patch) {
      if (patch.entrypointRelPath) next.entrypointRelPath = patch.entrypointRelPath;
      else delete next.entrypointRelPath;
    }
    await db.papers.put(next);
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
    const paper = await db.papers.get(id);
    const format = paper?.format ?? "pdf";
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
    // Revisions of different papers can share a sha (same bytes); we probe
    // before deleting. The blob lives in either the PDF or MD OPFS dir
    // depending on the paper's format.
    const deleteBlob = format === "md" ? deleteMd : deletePdf;
    for (const sha256 of sha256s) {
      const stillReferenced = await db.revisions.where("pdfSha256").equals(sha256).first();
      if (!stillReferenced) await deleteBlob(sha256);
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
  async listForRevision(
    revisionId: string,
    opts?: { includeResolved?: boolean },
  ): Promise<AnnotationRow[]> {
    const all = await getDb()
      .annotations.where("revisionId")
      .equals(revisionId)
      .sortBy("createdAt");
    if (opts?.includeResolved) return all;
    return all.filter((r) => r.resolvedInEditId === undefined);
  },

  async bulkPut(revisionId: string, rows: AnnotationRow[]): Promise<void> {
    const stamped = rows.map((r) => ({ ...r, revisionId }));
    await getDb().annotations.bulkPut(stamped);
  },

  async remove(id: string): Promise<void> {
    await getDb().annotations.delete(id);
  },

  async markResolvedInEdit(ids: ReadonlyArray<string>, editId: string): Promise<void> {
    if (ids.length === 0) return;
    const db = getDb();
    await db.transaction("rw", db.annotations, async () => {
      for (const id of ids) {
        await db.annotations.update(id, { resolvedInEditId: editId });
      }
    });
  },

  async setStaleness(patches: ReadonlyArray<AnnotationStalenessPatch>): Promise<void> {
    if (patches.length === 0) return;
    const db = getDb();
    await db.transaction("rw", db.annotations, async () => {
      for (const { id, staleness } of patches) {
        await db.annotations.update(id, { staleness });
      }
    });
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
