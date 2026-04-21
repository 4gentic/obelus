import {
  type AskThreadsRepo,
  type DesksRepo,
  type DiffHunksRepo,
  type FilePinsRepo,
  NotSupportedError,
  type ProjectsRepo,
  type Repository,
  type RepositoryFeature,
  type ReviewSessionsRepo,
  type WriteUpsRepo,
} from "../interface";
import { annotations, papers, revisions, settings } from "./repositories";

const projectsStub: ProjectsRepo = {
  list: () => Promise.reject(new NotSupportedError("projects")),
  get: () => Promise.reject(new NotSupportedError("projects")),
  create: () => Promise.reject(new NotSupportedError("projects")),
  rename: () => Promise.reject(new NotSupportedError("projects")),
  setPinned: () => Promise.reject(new NotSupportedError("projects")),
  forget: () => Promise.reject(new NotSupportedError("projects")),
  repoint: () => Promise.reject(new NotSupportedError("projects")),
  moveToDesk: () => Promise.reject(new NotSupportedError("projects")),
  touchLastOpened: () => Promise.reject(new NotSupportedError("projects")),
  setLastOpenedFile: () => Promise.reject(new NotSupportedError("projects")),
};

const desksStub: DesksRepo = {
  list: () => Promise.reject(new NotSupportedError("desks")),
  get: () => Promise.reject(new NotSupportedError("desks")),
  create: () => Promise.reject(new NotSupportedError("desks")),
  rename: () => Promise.reject(new NotSupportedError("desks")),
  remove: () => Promise.reject(new NotSupportedError("desks")),
  touchLastOpened: () => Promise.reject(new NotSupportedError("desks")),
  countProjects: () => Promise.reject(new NotSupportedError("desks")),
};

const reviewSessionsStub: ReviewSessionsRepo = {
  list: () => Promise.reject(new NotSupportedError("reviewSessions")),
  get: () => Promise.reject(new NotSupportedError("reviewSessions")),
  latestForProject: () => Promise.reject(new NotSupportedError("reviewSessions")),
  create: () => Promise.reject(new NotSupportedError("reviewSessions")),
  complete: () => Promise.reject(new NotSupportedError("reviewSessions")),
  markApplied: () => Promise.reject(new NotSupportedError("reviewSessions")),
};

const diffHunksStub: DiffHunksRepo = {
  listForSession: () => Promise.reject(new NotSupportedError("diffHunks")),
  upsertMany: () => Promise.reject(new NotSupportedError("diffHunks")),
  setState: () => Promise.reject(new NotSupportedError("diffHunks")),
  setModifiedPatch: () => Promise.reject(new NotSupportedError("diffHunks")),
  setNote: () => Promise.reject(new NotSupportedError("diffHunks")),
  acceptAllInFile: () => Promise.reject(new NotSupportedError("diffHunks")),
  countsByState: () => Promise.reject(new NotSupportedError("diffHunks")),
};

const askThreadsStub: AskThreadsRepo = {
  getOrCreate: () => Promise.reject(new NotSupportedError("askThreads")),
  listMessages: () => Promise.reject(new NotSupportedError("askThreads")),
  appendMessage: () => Promise.reject(new NotSupportedError("askThreads")),
  updateMessage: () => Promise.reject(new NotSupportedError("askThreads")),
  clear: () => Promise.reject(new NotSupportedError("askThreads")),
};

const writeUpsStub: WriteUpsRepo = {
  listForProject: () => Promise.reject(new NotSupportedError("writeUps")),
  getForPaper: () => Promise.reject(new NotSupportedError("writeUps")),
  upsert: () => Promise.reject(new NotSupportedError("writeUps")),
};

const filePinsStub: FilePinsRepo = {
  listForProject: () => Promise.reject(new NotSupportedError("filePins")),
  pin: () => Promise.reject(new NotSupportedError("filePins")),
  unpin: () => Promise.reject(new NotSupportedError("filePins")),
  isPinned: () => Promise.reject(new NotSupportedError("filePins")),
};

export function buildWebRepository(): Repository {
  const self: Repository = {
    papers,
    revisions,
    annotations,
    settings,
    projects: projectsStub,
    desks: desksStub,
    reviewSessions: reviewSessionsStub,
    diffHunks: diffHunksStub,
    askThreads: askThreadsStub,
    writeUps: writeUpsStub,
    filePins: filePinsStub,
    supports(_feature: RepositoryFeature): boolean {
      return false;
    },
    transaction<T>(fn: (tx: Repository) => Promise<T>): Promise<T> {
      // Dexie manages its own transactions per call; the public Repository
      // transaction boundary is a desktop-only SQLite concern. On web we just
      // run the function — nested Dexie ops still atomicize inside their own
      // `db.transaction` calls in repositories.ts.
      return fn(self);
    },
  };
  return self;
}
