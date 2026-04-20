import Dexie, { type EntityTable } from "dexie";
import type { AnnotationRow, PaperRow, RevisionRow, SettingRow } from "../types";

export type { AnnotationRow, PaperRow, RevisionRow, SettingRow };

export class ObelusDb extends Dexie {
  declare papers: EntityTable<PaperRow, "id">;
  declare revisions: EntityTable<RevisionRow, "id">;
  declare annotations: EntityTable<AnnotationRow, "id">;
  declare settings: EntityTable<SettingRow, "key">;

  constructor(name = "obelus") {
    super(name);
    this.version(1).stores({
      papers: "id, createdAt, pdfSha256",
      revisions: "id, paperId, pdfSha256, createdAt",
      annotations: "id, revisionId, page, category, createdAt",
      settings: "key",
    });
    // v1 stored rects/bbox in viewport pixels at the scale active when the
    // annotation was created; v2 stores them scale-independent (scale=1) and
    // multiplies by current scale at render. The two formats aren't
    // interconvertible without the original scale, so legacy rows are cleared.
    this.version(2)
      .stores({
        papers: "id, createdAt, pdfSha256",
        revisions: "id, paperId, pdfSha256, createdAt",
        annotations: "id, revisionId, page, category, createdAt",
        settings: "key",
      })
      .upgrade((tx) => tx.table("annotations").clear());
    // v3 adds an optional `rubric` field on PaperRow. Dexie tolerates added
    // optional payload fields; the version bump exists so older deployments
    // re-open the database against the current schema.
    this.version(3).stores({
      papers: "id, createdAt, pdfSha256",
      revisions: "id, paperId, pdfSha256, createdAt",
      annotations: "id, revisionId, page, category, createdAt",
      settings: "key",
    });
  }
}

let singleton: ObelusDb | null = null;

export function getDb(): ObelusDb {
  if (!singleton) singleton = new ObelusDb();
  return singleton;
}

export function setDbForTests(db: ObelusDb | null): void {
  singleton = db;
}
