import type { ZodType } from "zod";
import type {
  AnnotationRow,
  AnnotationStaleness,
  AppliedSnapshot,
  AskMessageRow,
  AskThreadRow,
  DeskRow,
  DiffHunkApplyFailure,
  DiffHunkRow,
  DiffHunkState,
  FilePinRow,
  PaperBuildCompiler,
  PaperBuildFormat,
  PaperBuildRow,
  PaperEditKind,
  PaperEditRow,
  PaperFormat,
  PaperRow,
  PaperRubric,
  ProjectFileFormat,
  ProjectFileRow,
  ProjectKind,
  ProjectRow,
  ReviewSessionRow,
  ReviewSessionStatus,
  RevisionRow,
  WriteUpRow,
} from "./types";

// Narrow sub-repo interfaces that any Repository implementation must satisfy.
// `PaperCreateInput` is a discriminated union: the web impl owns bytes (OPFS),
// the desktop impl references on-disk paths.

export type PaperCreateInput =
  | { source: "bytes"; title: string; pdfBytes: ArrayBuffer; format?: PaperFormat }
  | { source: "md"; title: string; mdText: string; file: string }
  | { source: "html"; title: string; htmlText: string; file: string }
  | {
      source: "ondisk";
      title: string;
      projectId: string;
      pdfRelPath: string;
      pdfSha256: string;
      pageCount: number;
      format?: PaperFormat;
    };

export type RevisionCreateInput =
  | { source: "bytes"; pdfBytes: ArrayBuffer; note?: string }
  | { source: "ondisk"; pdfRelPath: string; pdfSha256: string; pageCount: number; note?: string };

export interface PaperPathsPatch {
  pdfRelPath?: string | null;
  entrypointRelPath?: string | null;
}

export interface PapersRepo {
  list(): Promise<PaperRow[]>;
  get(id: string): Promise<PaperRow | undefined>;
  rename(id: string, title: string): Promise<void>;
  create(input: PaperCreateInput): Promise<{ paper: PaperRow; revision: RevisionRow }>;
  setRubric(id: string, rubric: PaperRubric | null): Promise<void>;
  // Updates on-disk path references after a file/folder move. Keys set to
  // `null` clear the column; omitted keys are left untouched.
  setPaths(id: string, patch: PaperPathsPatch): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface RevisionsRepo {
  listForPaper(paperId: string): Promise<RevisionRow[]>;
  get(id: string): Promise<RevisionRow | undefined>;
  createFromPaper(paperId: string, input: RevisionCreateInput): Promise<RevisionRow>;
}

export interface AnnotationStalenessPatch {
  id: string;
  staleness: AnnotationStaleness;
}

export interface AnnotationsRepo {
  // `visibleFromEditId` makes "resolved" relative to the currently-viewed
  // draft: an annotation whose `resolved_in_edit_id` is NOT an ancestor of
  // `visibleFromEditId` is treated as active (reappears after a revert).
  // When omitted, falls back to "resolved iff resolved_in_edit_id IS NOT NULL".
  // `includeResolved` overrides both and returns every row on the revision.
  listForRevision(
    revisionId: string,
    opts?: { includeResolved?: boolean; visibleFromEditId?: string },
  ): Promise<AnnotationRow[]>;
  bulkPut(revisionId: string, rows: AnnotationRow[]): Promise<void>;
  remove(id: string): Promise<void>;
  markResolvedInEdit(ids: ReadonlyArray<string>, editId: string): Promise<void>;
  // Used by the writer-mode save-verify path and the external-change watcher
  // to record each mark's last verification outcome. Only updates the
  // `staleness` column; the rest of the row is untouched.
  setStaleness(patches: ReadonlyArray<AnnotationStalenessPatch>): Promise<void>;
}

export interface SettingsRepo {
  // Read-side validation is the boundary's job. Callers pass a Zod schema for
  // the shape they expect; bytes that fail to parse return `undefined` and are
  // logged once. `set` keeps an internal-trust signature: the value is already
  // typed at the call site and runtime validation only matters on read.
  get<T>(key: string, schema: ZodType<T>): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
}

export interface ProjectCreateInput {
  label: string;
  kind: ProjectKind;
  root: string;
  deskId: string;
}

export interface ProjectsRepo {
  list(deskId?: string): Promise<ProjectRow[]>;
  get(id: string): Promise<ProjectRow | undefined>;
  create(input: ProjectCreateInput): Promise<ProjectRow>;
  rename(id: string, label: string): Promise<void>;
  setPinned(id: string, pinned: boolean): Promise<void>;
  forget(id: string): Promise<void>;
  moveToDesk(id: string, deskId: string): Promise<void>;
  touchLastOpened(id: string): Promise<void>;
  setLastOpenedFile(id: string, path: string | null): Promise<void>;
}

export interface DeskCreateInput {
  name: string;
}

export interface DesksRepo {
  list(): Promise<DeskRow[]>;
  get(id: string): Promise<DeskRow | undefined>;
  create(input: DeskCreateInput): Promise<DeskRow>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
  touchLastOpened(id: string): Promise<void>;
}

export interface ReviewSessionCreateInput {
  projectId: string;
  paperId: string;
  bundleId: string;
  model: string | null;
  effort: string | null;
}

export interface ReviewSessionsRepo {
  listForPaper(paperId: string): Promise<ReviewSessionRow[]>;
  get(id: string): Promise<ReviewSessionRow | undefined>;
  latestForPaper(paperId: string): Promise<ReviewSessionRow | undefined>;
  create(input: ReviewSessionCreateInput): Promise<ReviewSessionRow>;
  complete(id: string): Promise<void>;
  markApplied(id: string): Promise<void>;
  setStatus(id: string, status: ReviewSessionStatus, lastError?: string | null): Promise<void>;
  setClaudeSessionId(id: string, claudeSessionId: string | null): Promise<void>;
  setAppliedSnapshot(id: string, snapshot: AppliedSnapshot | null): Promise<void>;
}

export interface DiffHunksRepo {
  listForSession(sessionId: string): Promise<DiffHunkRow[]>;
  upsertMany(sessionId: string, rows: ReadonlyArray<DiffHunkRow>): Promise<void>;
  setState(id: string, state: DiffHunkState): Promise<void>;
  setModifiedPatch(id: string, patch: string): Promise<void>;
  setNote(id: string, note: string): Promise<void>;
  acceptAllInFile(sessionId: string, file: string): Promise<void>;
  acceptAllInSession(sessionId: string): Promise<void>;
  rejectAllInSession(sessionId: string): Promise<void>;
  countsByState(sessionId: string): Promise<Record<DiffHunkState, number>>;
  setApplyFailure(id: string, failure: DiffHunkApplyFailure | null): Promise<void>;
  clearApplyFailures(sessionId: string): Promise<void>;
}

export interface AskMessageAppendInput {
  role: "user" | "assistant";
  body: string;
  cancelled?: boolean;
}

export interface AskThreadsRepo {
  getOrCreate(projectId: string, paperId: string | null): Promise<AskThreadRow>;
  listMessages(threadId: string): Promise<AskMessageRow[]>;
  appendMessage(threadId: string, input: AskMessageAppendInput): Promise<AskMessageRow>;
  updateMessage(id: string, patch: { body?: string; cancelled?: boolean }): Promise<void>;
  clear(threadId: string): Promise<void>;
}

export interface WriteUpsRepo {
  listForProject(projectId: string): Promise<WriteUpRow[]>;
  getForPaper(projectId: string, paperId: string): Promise<WriteUpRow | undefined>;
  upsert(input: { projectId: string; paperId: string; bodyMd: string }): Promise<WriteUpRow>;
}

export interface FilePinsRepo {
  listForProject(projectId: string): Promise<FilePinRow[]>;
  pin(projectId: string, relPath: string): Promise<void>;
  unpin(projectId: string, relPath: string): Promise<void>;
  isPinned(projectId: string, relPath: string): Promise<boolean>;
}

export interface PaperEditCreateInput {
  projectId: string;
  paperId: string;
  parentEditId: string | null;
  kind: PaperEditKind;
  sessionId: string | null;
  manifestSha256: string;
  summary: string;
  noteMd?: string;
}

export interface PaperEditsRepo {
  listForPaper(paperId: string, opts?: { includeTombstoned?: boolean }): Promise<PaperEditRow[]>;
  get(id: string): Promise<PaperEditRow | undefined>;
  head(paperId: string): Promise<PaperEditRow | undefined>;
  baseline(paperId: string): Promise<PaperEditRow | undefined>;
  create(input: PaperEditCreateInput): Promise<PaperEditRow>;
  setNote(id: string, noteMd: string): Promise<void>;
  setSummary(id: string, summary: string): Promise<void>;
  tombstoneDescendantsOf(editId: string): Promise<{ tombstoned: string[] }>;
  tombstoneMany(ids: ReadonlyArray<string>): Promise<void>;
  restore(id: string): Promise<void>;
  countForPaper(paperId: string, opts?: { includeTombstoned?: boolean }): Promise<number>;
}

export interface ProjectFilesRepo {
  listForProject(
    projectId: string,
    opts?: { format?: ProjectFileFormat },
  ): Promise<ProjectFileRow[]>;
  replaceAll(projectId: string, rows: ReadonlyArray<ProjectFileRow>): Promise<void>;
}

export interface PaperBuildPatch {
  format?: PaperBuildFormat | null;
  mainRelPath?: string | null;
  mainIsPinned?: boolean;
  compiler?: PaperBuildCompiler | null;
  compilerArgs?: string[];
  outputRelDir?: string | null;
  scannedAt?: string | null;
}

export interface PaperBuildRepo {
  get(paperId: string): Promise<PaperBuildRow | undefined>;
  upsert(paperId: string, patch: PaperBuildPatch): Promise<PaperBuildRow>;
  setMain(paperId: string, relPath: string | null, pinned: boolean): Promise<PaperBuildRow>;
}

export type RepositoryFeature =
  | "projects"
  | "desks"
  | "reviewSessions"
  | "diffHunks"
  | "askThreads"
  | "writeUps"
  | "filePins"
  | "paperEdits"
  | "projectFiles"
  | "paperBuild";

export interface Repository {
  papers: PapersRepo;
  revisions: RevisionsRepo;
  annotations: AnnotationsRepo;
  settings: SettingsRepo;
  projects: ProjectsRepo;
  desks: DesksRepo;
  reviewSessions: ReviewSessionsRepo;
  diffHunks: DiffHunksRepo;
  askThreads: AskThreadsRepo;
  writeUps: WriteUpsRepo;
  filePins: FilePinsRepo;
  paperEdits: PaperEditsRepo;
  projectFiles: ProjectFilesRepo;
  paperBuild: PaperBuildRepo;
  supports(feature: RepositoryFeature): boolean;
  transaction<T>(fn: (tx: Repository) => Promise<T>): Promise<T>;
}

export class NotSupportedError extends Error {
  constructor(feature: RepositoryFeature) {
    super(`${feature} is not supported in this repository implementation`);
    this.name = "NotSupportedError";
  }
}
