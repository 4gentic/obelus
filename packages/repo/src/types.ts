// Storage row shapes shared by every Repository implementation (Dexie today,
// SQLite later). Implementations map these to/from their native rows.

import type * as BundleSchema from "@obelus/bundle-schema";
import type { z } from "zod";

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
  // Set when a draft has landed the hunk this mark spawned; archives it from
  // the active Marks tab but keeps it addressable.
  resolvedInEditId?: string;
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

export type ReviewSessionStatus = "running" | "ingesting" | "completed" | "failed" | "discarded";

export interface AppliedSnapshot {
  filesWritten: number;
  hunksApplied: number;
  draftOrdinal?: number;
}

export interface ReviewSessionRow {
  id: string;
  projectId: string;
  paperId: string;
  bundleId: string;
  model: string | null;
  effort: string | null;
  startedAt: string;
  completedAt: string | null;
  appliedAt: string | null;
  status: ReviewSessionStatus;
  lastError: string | null;
  appliedSnapshot: AppliedSnapshot | null;
  claudeSessionId: string | null;
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

export interface FilePinRow {
  projectId: string;
  relPath: string;
  pinnedAt: string;
}

export type PaperEditKind = "baseline" | "ai" | "manual";
export type PaperEditState = "live" | "tombstoned";

export interface PaperEditRow {
  id: string;
  projectId: string;
  paperId: string;
  parentEditId: string | null;
  ordinal: number;
  kind: PaperEditKind;
  sessionId: string | null;
  manifestSha256: string;
  summary: string;
  noteMd: string;
  state: PaperEditState;
  createdAt: string;
}

export type ProjectFileFormat = z.infer<typeof BundleSchema.ProjectFileFormat>;
export type ProjectFileRole = z.infer<typeof BundleSchema.ProjectFileRole>;

export interface ProjectFileRow {
  projectId: string;
  relPath: string;
  format: ProjectFileFormat;
  role: ProjectFileRole | null;
  size: number;
  mtimeMs: number;
  scannedAt: string;
}

export type PaperBuildFormat = z.infer<typeof BundleSchema.PaperBuildFormat>;
export type PaperBuildCompiler = z.infer<typeof BundleSchema.PaperBuildCompiler>;

export interface PaperBuildRow {
  paperId: string;
  format: PaperBuildFormat | null;
  mainRelPath: string | null;
  mainIsPinned: boolean;
  compiler: PaperBuildCompiler | null;
  compilerArgs: string[];
  outputRelDir: string | null;
  scannedAt: string | null;
  updatedAt: string;
}
