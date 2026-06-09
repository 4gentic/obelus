import { type MarksArchive, type MarksArchiveMark, parseMarksArchive } from "@obelus/bundle-schema";
import { DEFAULT_CATEGORIES } from "@obelus/categories";
import {
  applyImportedMarks,
  buildMarksArchive,
  type ImportMode,
  importMarksArchive,
} from "@obelus/marks-transfer";
import { save } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { fsWriteTextAbs, openMarksPicker } from "../../ipc/commands";
import { useProject } from "./context";
import { slugify, timestampForFilename } from "./filename";
import { useOpenPaper } from "./OpenPaper";
import { useReanchor } from "./reanchor-context";
import { useReviewStore } from "./store-context";

const MARKS_TOOL_VERSION = "0.1.0";

export type MarksStatus =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "ok"; message: string }
  | {
      kind: "confirm-import";
      archive: MarksArchive;
      latestId: string;
      existingCount: number;
    };

export interface PendingMarksImport {
  incoming: number;
  existing: number;
  onReplace: () => void;
  onMerge: () => void;
  onCancel: () => void;
}

export interface MarksTransfer {
  onExportMarks: () => Promise<void>;
  onImportMarks: () => Promise<void>;
  onConfirmImport: (mode: ImportMode) => void;
  onCancelImport: () => void;
  marksStatus: MarksStatus;
  pendingImport: PendingMarksImport | null;
}

// Portable marks transfer for the desktop Marks tab. Lifted out of
// ReviewerActionsPanel so the Marks view (ReviewList) and the Review view share
// one implementation; re-anchoring rides the surface-published provider via
// `useReanchor`, exactly as it did when this lived in the actions panel.
export function useMarksTransfer(): MarksTransfer {
  const { repo } = useProject();
  const openPaper = useOpenPaper();
  const reviewStore = useReviewStore();
  const reanchorProvider = useReanchor();
  const [marksStatus, setMarksStatus] = useState<MarksStatus>({ kind: "idle" });

  const pdfReady = openPaper.kind === "ready";
  const mdReady = openPaper.kind === "ready-md" && openPaper.paper !== null;
  const paperReady = pdfReady || mdReady;
  const activePaper = pdfReady
    ? openPaper.paper
    : openPaper.kind === "ready-md"
      ? openPaper.paper
      : null;
  const paperId = activePaper?.id ?? null;
  const paperTitle = activePaper?.title ?? "";

  async function onExportMarks(): Promise<void> {
    if (!paperReady || !paperId || !activePaper) return;
    setMarksStatus({ kind: "idle" });
    try {
      const revisions = await repo.revisions.listForPaper(paperId);
      const latest = revisions[revisions.length - 1];
      if (!latest) {
        setMarksStatus({ kind: "error", message: "Paper has no revision yet." });
        return;
      }
      const rows = await repo.annotations.listForRevision(latest.id);
      const archive = buildMarksArchive({
        rows,
        document: {
          format: activePaper.format,
          title: activePaper.title,
          pdfSha256: activePaper.pdfSha256,
          ...(activePaper.pageCount !== undefined ? { pageCount: activePaper.pageCount } : {}),
        },
        categories: DEFAULT_CATEGORIES.map((c) => ({ slug: c.id, label: c.label })),
        toolVersion: MARKS_TOOL_VERSION,
      });
      const defaultName = `marks-${slugify(paperTitle || "paper")}-${timestampForFilename()}.json`;
      const picked = await save({
        defaultPath: defaultName,
        filters: [{ name: "Marks", extensions: ["json"] }],
      });
      if (!picked) return;
      await fsWriteTextAbs(picked, JSON.stringify(archive, null, 2));
      setMarksStatus({
        kind: "ok",
        message: `Exported ${archive.marks.length} marks to ${picked}`,
      });
    } catch (err) {
      setMarksStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function onImportMarks(): Promise<void> {
    if (!paperReady || !paperId || !activePaper) return;
    setMarksStatus({ kind: "idle" });
    try {
      const text = await openMarksPicker();
      if (text === null) return;
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        setMarksStatus({ kind: "error", message: "Not valid JSON." });
        return;
      }
      const parsed = parseMarksArchive(raw);
      if (!parsed.ok) {
        setMarksStatus({ kind: "error", message: parsed.error });
        return;
      }
      const archive = parsed.archive;
      const revisions = await repo.revisions.listForPaper(paperId);
      const latest = revisions[revisions.length - 1];
      if (!latest) {
        setMarksStatus({ kind: "error", message: "Paper has no revision yet." });
        return;
      }
      const existingCount = (
        await repo.annotations.listForRevision(latest.id, { includeResolved: true })
      ).length;
      if (existingCount === 0) {
        await completeImport(archive, latest.id, 0, "merge");
        return;
      }
      setMarksStatus({ kind: "confirm-import", archive, latestId: latest.id, existingCount });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.info("[ingest-marks]", { paperId, failed: true, error: message });
      setMarksStatus({ kind: "error", message });
    }
  }

  async function completeImport(
    archive: MarksArchive,
    latestId: string,
    existingCount: number,
    mode: ImportMode,
  ): Promise<void> {
    if (!activePaper) return;
    setMarksStatus({ kind: "idle" });
    try {
      const reanchor = reanchorProvider
        ? (mark: MarksArchiveMark) => reanchorProvider.reanchor(mark)
        : undefined;
      const { rows: importedRows, report } = await importMarksArchive({
        archive,
        targetRevisionId: latestId,
        targetPdfSha256: activePaper.pdfSha256,
        targetFormat: activePaper.format,
        targetCategorySlugs: new Set(DEFAULT_CATEGORIES.map((c) => c.id)),
        ...(reanchor ? { reanchor } : {}),
        newId: () => crypto.randomUUID(),
      });
      await applyImportedMarks(repo.annotations, latestId, importedRows, mode);
      await reviewStore.getState().load(latestId);
      console.info("[ingest-marks]", {
        targetRevisionId: latestId,
        sourceTitle: archive.document.title,
        sourceFormat: archive.document.format,
        targetFormat: activePaper.format,
        mode,
        cleared: mode === "replace" ? existingCount : 0,
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
      setMarksStatus({ kind: "ok", message: report.message });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.info("[ingest-marks]", { paperId, failed: true, error: message });
      setMarksStatus({ kind: "error", message });
    }
  }

  function onConfirmImport(mode: ImportMode): void {
    if (marksStatus.kind !== "confirm-import") return;
    void completeImport(marksStatus.archive, marksStatus.latestId, marksStatus.existingCount, mode);
  }

  function onCancelImport(): void {
    setMarksStatus({ kind: "idle" });
  }

  const pendingImport: PendingMarksImport | null =
    marksStatus.kind === "confirm-import"
      ? {
          incoming: marksStatus.archive.marks.length,
          existing: marksStatus.existingCount,
          onReplace: () => onConfirmImport("replace"),
          onMerge: () => onConfirmImport("merge"),
          onCancel: onCancelImport,
        }
      : null;

  return {
    onExportMarks,
    onImportMarks,
    onConfirmImport,
    onCancelImport,
    marksStatus,
    pendingImport,
  };
}
