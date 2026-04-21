import type {
  AnnotationRow,
  AskMessageRow,
  AskThreadRow,
  DeskRow,
  DiffHunkRow,
  DiffHunkState,
  FilePinRow,
  PaperRow,
  PaperRubric,
  ProjectKind,
  ProjectRow,
  ReviewSessionRow,
  RevisionRow,
  WriteUpRow,
} from "./types";

// Narrow sub-repo interfaces that any Repository implementation must satisfy.
// `PaperCreateInput` is a discriminated union: the web impl owns bytes (OPFS),
// the desktop impl references on-disk paths.

export type PaperCreateInput =
  | { source: "bytes"; title: string; pdfBytes: ArrayBuffer }
  | {
      source: "ondisk";
      title: string;
      projectId: string;
      pdfRelPath: string;
      pdfSha256: string;
      pageCount: number;
    };

export type RevisionCreateInput =
  | { source: "bytes"; pdfBytes: ArrayBuffer; note?: string }
  | { source: "ondisk"; pdfRelPath: string; pdfSha256: string; pageCount: number; note?: string };

export interface PapersRepo {
  list(): Promise<PaperRow[]>;
  get(id: string): Promise<PaperRow | undefined>;
  rename(id: string, title: string): Promise<void>;
  create(input: PaperCreateInput): Promise<{ paper: PaperRow; revision: RevisionRow }>;
  setRubric(id: string, rubric: PaperRubric | null): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface RevisionsRepo {
  listForPaper(paperId: string): Promise<RevisionRow[]>;
  get(id: string): Promise<RevisionRow | undefined>;
  createFromPaper(paperId: string, input: RevisionCreateInput): Promise<RevisionRow>;
}

export interface AnnotationsRepo {
  listForRevision(revisionId: string): Promise<AnnotationRow[]>;
  bulkPut(revisionId: string, rows: AnnotationRow[]): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface SettingsRepo {
  get<T>(key: string): Promise<T | undefined>;
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
  repoint(id: string, newRoot: string): Promise<void>;
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
  countProjects(id: string): Promise<number>;
}

export interface ReviewSessionCreateInput {
  projectId: string;
  bundleId: string;
  claudeVersion: string | null;
  model: string | null;
  effort: string | null;
}

export interface ReviewSessionsRepo {
  list(projectId: string): Promise<ReviewSessionRow[]>;
  get(id: string): Promise<ReviewSessionRow | undefined>;
  latestForProject(projectId: string): Promise<ReviewSessionRow | undefined>;
  create(input: ReviewSessionCreateInput): Promise<ReviewSessionRow>;
  complete(id: string): Promise<void>;
  markApplied(id: string): Promise<void>;
}

export interface DiffHunksRepo {
  listForSession(sessionId: string): Promise<DiffHunkRow[]>;
  upsertMany(sessionId: string, rows: ReadonlyArray<DiffHunkRow>): Promise<void>;
  setState(id: string, state: DiffHunkState): Promise<void>;
  setModifiedPatch(id: string, patch: string): Promise<void>;
  setNote(id: string, note: string): Promise<void>;
  acceptAllInFile(sessionId: string, file: string): Promise<void>;
  countsByState(sessionId: string): Promise<Record<DiffHunkState, number>>;
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

export type RepositoryFeature =
  | "projects"
  | "desks"
  | "reviewSessions"
  | "diffHunks"
  | "askThreads"
  | "writeUps"
  | "filePins";

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
  supports(feature: RepositoryFeature): boolean;
  transaction<T>(fn: (tx: Repository) => Promise<T>): Promise<T>;
}

export class NotSupportedError extends Error {
  constructor(feature: RepositoryFeature) {
    super(`${feature} is not supported in this repository implementation`);
    this.name = "NotSupportedError";
  }
}
