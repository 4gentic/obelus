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
    // Pre-release: nobody has an installed copy, so the schema is collapsed to
    // a single v1 mirroring the desktop SQLite init. When shape needs to
    // change post-release, add `this.version(2).stores({...}).upgrade(...)` —
    // never edit a shipped version.
    this.version(1).stores({
      papers: "id, createdAt, pdfSha256, format",
      revisions: "id, paperId, pdfSha256, createdAt",
      annotations: "id, revisionId, category, createdAt",
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
