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

export type PaperFormat = "pdf" | "md" | "html";

export interface PaperRow {
  id: string;
  title: string;
  createdAt: string;
  format: PaperFormat;
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

// Anchor fields mirror the bundle-schema's discriminated `Anchor` Zod, plus
// `rects` on the PDF arm — a UI cache for the per-line highlight overlay that
// the canonical `bbox` doesn't carry. The wire format (bundle JSON) intentionally
// omits `rects`; only the row carries it because only the renderer needs it.
export type PdfAnchorFields = {
  kind: "pdf";
  page: number;
  bbox: [number, number, number, number];
  textItemRange: {
    start: [number, number];
    end: [number, number];
  };
  rects?: Array<[number, number, number, number]>;
};

export type SourceAnchorFields = z.infer<typeof BundleSchema.SourceAnchor>;

export type HtmlAnchorFields = z.infer<typeof BundleSchema.HtmlAnchor>;

export type HtmlElementAnchorFields = z.infer<typeof BundleSchema.HtmlElementAnchor>;

export type AnchorFields =
  | PdfAnchorFields
  | SourceAnchorFields
  | HtmlAnchorFields
  | HtmlElementAnchorFields;

export interface AnnotationRow {
  id: string;
  revisionId: string;
  category: string;
  quote: string;
  contextBefore: string;
  contextAfter: string;
  anchor: AnchorFields;
  note: string;
  thread: Array<{ at: string; body: string }>;
  createdAt: string;
  // Present when a cross-page selection produced multiple linked marks.
  groupId?: string;
  // Set when a draft has landed the hunk this mark spawned; archives it from
  // the active Marks tab but keeps it addressable.
  resolvedInEditId?: string;
  // Last verification outcome of this mark's anchor against the current
  // source bytes. Unset means "never verified" (treated as `ok` by the UI
  // until proven otherwise). Set by the writer-mode re-verify-on-save path
  // and by the external-change watcher.
  staleness?: AnnotationStaleness;
}

export type AnnotationStaleness = "ok" | "line-out-of-range" | "quote-mismatch";

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

export interface DiffHunkApplyFailure {
  reason: string;
  attemptedAt: string;
}

// Categorical reason a hunk arrived with `patch === ""`. Mirrors the planner's
// emptyReason field in the plan JSON; the diff-review UI keys off it to render
// margin badges (praised, ambiguous, impact, no-edit) instead of dumping a
// generic "skipped" placeholder into the diff list.
export type DiffHunkEmptyReason = "praise" | "ambiguous" | "structural-note" | "no-edit-requested";

export interface DiffHunkRow {
  id: string;
  sessionId: string;
  // Marks this hunk satisfies. A user-mark hunk carries one or more annotation
  // UUIDs (>1 when the planner merged overlapping marks into a single edit);
  // a synthesised hunk (cascade-/impact-/coherence-/quality-/compile-) carries
  // exactly one synthesised id whose prefix downstream readers key on.
  annotationIds: string[];
  file: string;
  category: string | null;
  patch: string;
  modifiedPatchText: string | null;
  state: DiffHunkState;
  ambiguous: boolean;
  // Set iff `patch === ""`. The discriminator the diff-review UI switches on.
  emptyReason: DiffHunkEmptyReason | null;
  noteText: string;
  // Planner prose attached to this block — the *agent's* explanation of why
  // it produced the patch (or, for empty patches, why no edit was made).
  // Distinct from `noteText`, which is the reviewer's followup that feeds
  // the repass prompt. Often empty for ordinary diffs; the value is most
  // interesting for informational marks where there is no diff to read.
  reviewerNotes: string;
  ordinal: number;
  // Populated by a partial apply when this hunk could not be applied against
  // the current source. Cleared on repass / discard / dismiss-failures.
  applyFailure: DiffHunkApplyFailure | null;
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
