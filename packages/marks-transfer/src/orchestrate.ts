import type { MarksArchive } from "@obelus/bundle-schema";
import { DEFAULT_CATEGORIES } from "@obelus/categories";
import type { AnnotationRow, PaperFormat } from "@obelus/repo";
import { applyImportedMarks, type ImportMode, type MarksWriter } from "./apply.js";
import { buildMarksArchive } from "./build.js";
import { type ImportReport, importMarksArchive, type ReanchorFn } from "./import.js";

// The provenance stamp shared by the marks archive and the review bundle, so a
// file's `tool.version` reads the same whichever export produced it.
export const MARKS_TOOL_VERSION = "0.1.0";

// Categories are global today, so both surfaces export the defaults. Keeping
// the slug/label projection here means a future per-project category set only
// has to be threaded through one place, not re-derived in each app.
function archiveCategories(): Array<{ slug: string; label: string }> {
  return DEFAULT_CATEGORIES.map((c) => ({ slug: c.id, label: c.label }));
}

export interface ExportMarksInput {
  rows: ReadonlyArray<AnnotationRow>;
  format: PaperFormat;
  title: string;
  // Content hash of the document the rows are anchored against (the target
  // revision's, not the paper row's — they can drift once a paper has more
  // than one revision).
  pdfSha256: string;
  pageCount?: number;
}

// Wraps `buildMarksArchive` with the app-level defaults (category set + tool
// version) so web and desktop produce byte-compatible archives.
export function buildMarksArchiveForExport(input: ExportMarksInput): MarksArchive {
  return buildMarksArchive({
    rows: input.rows,
    document: {
      format: input.format,
      title: input.title,
      pdfSha256: input.pdfSha256,
      ...(input.pageCount !== undefined ? { pageCount: input.pageCount } : {}),
    },
    categories: archiveCategories(),
    toolVersion: MARKS_TOOL_VERSION,
  });
}

export type ImportTone = "done" | "error";

export interface RunMarksImportInput {
  archive: MarksArchive;
  writer: MarksWriter;
  targetRevisionId: string;
  targetPdfSha256: string;
  targetFormat: PaperFormat;
  mode: ImportMode;
  // Marks already on the target revision before this import — only used to
  // report how many a "replace" cleared.
  existingCount: number;
  reanchor?: ReanchorFn;
  newId: () => string;
}

export interface RunMarksImportOutcome {
  report: ImportReport;
  importedCount: number;
  // "error" only when the archive is for another format and nothing applied; a
  // flagged-but-kept import is still a success. Decided here so web and desktop
  // can't disagree on the status tone.
  tone: ImportTone;
}

// The marks-import boundary: re-anchor + persist the archive, then emit the one
// canonical `[ingest-marks]` trace. Both apps call this so the ingest log shape
// and the success/error verdict live in a single place.
export async function runMarksImport(input: RunMarksImportInput): Promise<RunMarksImportOutcome> {
  const { archive, targetRevisionId, targetFormat, mode } = input;
  const { rows, report } = await importMarksArchive({
    archive,
    targetRevisionId,
    targetPdfSha256: input.targetPdfSha256,
    targetFormat,
    targetCategorySlugs: new Set(DEFAULT_CATEGORIES.map((c) => c.id)),
    ...(input.reanchor ? { reanchor: input.reanchor } : {}),
    newId: input.newId,
  });
  await applyImportedMarks(input.writer, targetRevisionId, rows, mode);
  console.info("[ingest-marks]", {
    targetRevisionId,
    sourceTitle: archive.document.title,
    sourceFormat: archive.document.format,
    targetFormat,
    mode,
    cleared: mode === "replace" ? input.existingCount : 0,
    hashMatch: report.hashMatch,
    markCount: archive.marks.length,
    matched: report.matched,
    reanchored: report.reanchored,
    flagged: report.flagged,
    skipped: report.skipped,
    flaggedIds: report.flaggedIds,
    droppedIds: report.droppedIds,
    unknownCategories: report.unknownCategories,
  });
  const tone: ImportTone =
    report.hashMatch === "format-mismatch" && rows.length === 0 ? "error" : "done";
  return { report, importedCount: rows.length, tone };
}
