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
    // v3 adds an optional `rubric` payload field on PaperRow. Dexie tolerates
    // added optional payload fields without index changes, but the explicit
    // version bump + no-op upgrade makes the intent audit-visible: older
    // deployments re-open against the current schema, no data transformation.
    this.version(3)
      .stores({
        papers: "id, createdAt, pdfSha256",
        revisions: "id, paperId, pdfSha256, createdAt",
        annotations: "id, revisionId, page, category, createdAt",
        settings: "key",
      })
      .upgrade(() => {});
    // v4 adds optional `resolvedInEditId` on annotations. The desktop owns
    // the PaperEdit DAG, so this field is always undefined on web today; the
    // schema stays aligned with the shared row type so a future desktop→web
    // bundle import doesn't drop the field silently.
    this.version(4)
      .stores({
        papers: "id, createdAt, pdfSha256",
        revisions: "id, paperId, pdfSha256, createdAt",
        annotations: "id, revisionId, page, category, createdAt",
        settings: "key",
      })
      .upgrade(() => {});
    // v5 adds `format` on PaperRow — 'pdf' for every existing row, 'md' (and
    // later 'html') for natively reviewed source papers. Index `format` so we
    // can quickly partition the library.
    this.version(5)
      .stores({
        papers: "id, createdAt, pdfSha256, format",
        revisions: "id, paperId, pdfSha256, createdAt",
        annotations: "id, revisionId, page, category, createdAt",
        settings: "key",
      })
      .upgrade((tx) =>
        tx
          .table("papers")
          .toCollection()
          .modify((p) => {
            if (p.format === undefined) p.format = "pdf";
          }),
      );
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
