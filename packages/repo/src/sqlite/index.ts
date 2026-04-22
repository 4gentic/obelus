import type { Repository, RepositoryFeature } from "../interface";
import { buildAnnotationsRepo } from "./annotations";
import { buildAskThreadsRepo } from "./ask-threads";
import type { Database } from "./db";
import { buildDesksRepo } from "./desks";
import { buildDiffHunksRepo } from "./diff-hunks";
import { buildFilePinsRepo } from "./file-pins";
import { buildPaperBuildRepo } from "./paper-build";
import { buildPaperEditsRepo } from "./paper-edits";
import { buildPapersRepo } from "./papers";
import { buildProjectFilesRepo } from "./project-files";
import { buildProjectsRepo } from "./projects";
import { buildReviewSessionsRepo } from "./review-sessions";
import { buildRevisionsRepo } from "./revisions";
import { buildSettingsRepo } from "./settings";
import { buildWriteUpsRepo } from "./writeups";

const SUPPORTED: ReadonlySet<RepositoryFeature> = new Set([
  "projects",
  "desks",
  "reviewSessions",
  "diffHunks",
  "askThreads",
  "writeUps",
  "filePins",
  "paperEdits",
  "projectFiles",
  "paperBuild",
]);

export function buildSqliteRepository(db: Database): Repository {
  const repo: Repository = {
    papers: buildPapersRepo(db),
    revisions: buildRevisionsRepo(db),
    annotations: buildAnnotationsRepo(db),
    settings: buildSettingsRepo(db),
    projects: buildProjectsRepo(db),
    desks: buildDesksRepo(db),
    reviewSessions: buildReviewSessionsRepo(db),
    diffHunks: buildDiffHunksRepo(db),
    askThreads: buildAskThreadsRepo(db),
    writeUps: buildWriteUpsRepo(db),
    filePins: buildFilePinsRepo(db),
    paperEdits: buildPaperEditsRepo(db),
    projectFiles: buildProjectFilesRepo(db),
    paperBuild: buildPaperBuildRepo(db),
    supports(feature: RepositoryFeature): boolean {
      return SUPPORTED.has(feature);
    },
    transaction<T>(fn: (tx: Repository) => Promise<T>): Promise<T> {
      // Per-repository calls that need atomicity route through `dbTxBatch`
      // directly. This top-level hook stays as a pass-through so the public
      // Repository shape matches the web implementation.
      return fn(repo);
    },
  };
  return repo;
}

export type { Database } from "./db";
export { getDb, setDbForTests } from "./db";
export type { TxStmt } from "./transaction";
export { dbTxBatch } from "./transaction";
