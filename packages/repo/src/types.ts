// Storage row shapes shared by every Repository implementation (Dexie today,
// SQLite later). Implementations map these to/from their native rows.

export interface PaperRubric {
  body: string;
  source: "file" | "paste" | "inline";
  label: string;
  updatedAt: string;
}

export interface PaperRow {
  id: string;
  title: string;
  createdAt: string;
  pdfSha256: string;
  projectId?: string;
  pdfRelPath?: string;
  pageCount?: number;
  entrypointRelPath?: string;
  rubric?: PaperRubric;
}

export interface RevisionRow {
  id: string;
  paperId: string;
  revisionNumber: number;
  pdfSha256: string;
  createdAt: string;
  note?: string;
}

export interface AnnotationRow {
  id: string;
  revisionId: string;
  category: string;
  quote: string;
  contextBefore: string;
  contextAfter: string;
  page: number;
  bbox: [number, number, number, number];
  rects?: Array<[number, number, number, number]>;
  textItemRange: {
    start: [number, number];
    end: [number, number];
  };
  note: string;
  thread: Array<{ at: string; body: string }>;
  createdAt: string;
  // Present when a cross-page selection produced multiple linked marks.
  groupId?: string;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

export type ProjectKind = "writer" | "reviewer";

export interface ProjectRow {
  id: string;
  label: string;
  kind: ProjectKind;
  root: string;
  pinned: boolean;
  archived: boolean;
  lastOpenedAt: string | null;
  lastOpenedFilePath: string | null;
  createdAt: string;
  deskId: string;
}

export interface DeskRow {
  id: string;
  name: string;
  lastOpenedAt: string | null;
  createdAt: string;
  sortOrder: number;
}

export interface ReviewSessionRow {
  id: string;
  projectId: string;
  bundleId: string;
  claudeVersion: string | null;
  model: string | null;
  effort: string | null;
  startedAt: string;
  completedAt: string | null;
  appliedAt: string | null;
}

export type DiffHunkState = "pending" | "accepted" | "rejected" | "modified";

export interface DiffHunkRow {
  id: string;
  sessionId: string;
  annotationId: string | null;
  file: string;
  category: string | null;
  patch: string;
  modifiedPatchText: string | null;
  state: DiffHunkState;
  ambiguous: boolean;
  noteText: string;
  ordinal: number;
}

export interface AskThreadRow {
  id: string;
  projectId: string;
  paperId: string | null;
  createdAt: string;
}

export type AskMessageRole = "user" | "assistant";

export interface AskMessageRow {
  id: string;
  threadId: string;
  role: AskMessageRole;
  body: string;
  createdAt: string;
  cancelled: boolean;
}

export interface WriteUpRow {
  id: string;
  projectId: string;
  paperId: string;
  bodyMd: string;
  updatedAt: string;
}
