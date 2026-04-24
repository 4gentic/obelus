import { useMdDocumentView } from "@obelus/md-view";
import "@obelus/md-view/md.css";
import "@obelus/review-shell/review-shell.css";
import type { PaperRow, RevisionRow } from "@obelus/repo";
import type { JSX } from "react";
import { useCallback, useState } from "react";
import { fsWriteBytes } from "../../ipc/commands";
import { exportMdBundleV2ForPaper } from "./build-bundle";
import { useProject } from "./context";
import { useReviewStore } from "./store-context";

interface Props {
  path: string;
  text: string;
  paper: PaperRow;
  revision: RevisionRow;
}

type ExportStatus =
  | { kind: "idle" }
  | { kind: "saved"; relPath: string }
  | { kind: "error"; message: string };

// Desktop MD reviewer. Uses the shared `useMdDocumentView` so marks paint as
// highlights over the preview (new) and the selection → SourceAnchor pipeline
// routes through the review-store (same as PDF). The bespoke marks sidebar
// and composer stay for now — unifying them with the web's `ReviewPane` is a
// follow-on task once the desktop ProjectShell absorbs the right column.
export default function MdReviewerPane({
  path,
  text,
  paper,
  revision: _revision,
}: Props): JSX.Element {
  const { repo, rootId } = useProject();
  const store = useReviewStore();
  const annotations = store((s) => s.annotations);
  const selectedAnchor = store((s) => s.selectedAnchor);
  const draftCategory = store((s) => s.draftCategory);
  const focusedId = store((s) => s.focusedAnnotationId);
  const setSelectedAnchor = store((s) => s.setSelectedAnchor);
  const setDraftCategory = store((s) => s.setDraftCategory);
  const setDraftNote = store((s) => s.setDraftNote);
  const draftNote = store((s) => s.draftNote);
  const saveAnnotation = store((s) => s.saveAnnotation);
  const deleteAnnotation = store((s) => s.deleteAnnotation);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<ExportStatus>({ kind: "idle" });

  const documentView = useMdDocumentView({
    file: path,
    text,
    annotations,
    selectedAnchor,
    draftCategory,
    focusedId,
    onAnchor: (draft) => setSelectedAnchor(draft),
    onRenderError: setRenderError,
  });

  const onSaveMark = useCallback(async () => {
    if (!selectedAnchor) return;
    const category = draftCategory ?? "unclear";
    await saveAnnotation({ draft: selectedAnchor, category, note: draftNote.trim() });
    document.getSelection()?.removeAllRanges();
  }, [selectedAnchor, draftCategory, draftNote, saveAnnotation]);

  const onCancelDraft = useCallback(() => {
    setSelectedAnchor(null);
    document.getSelection()?.removeAllRanges();
  }, [setSelectedAnchor]);

  const onExport = useCallback(async () => {
    setExportStatus({ kind: "idle" });
    try {
      const { filename, json } = await exportMdBundleV2ForPaper({ repo, paperId: paper.id });
      const bytes = new TextEncoder().encode(json);
      await fsWriteBytes(rootId, filename, bytes);
      setExportStatus({ kind: "saved", relPath: filename });
    } catch (err) {
      setExportStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not export bundle.",
      });
    }
  }, [repo, paper.id, rootId]);

  return (
    <section className="md-reviewer" aria-label={`Reviewing ${paper.title}`}>
      <header className="md-reviewer__header">
        <h2 className="md-reviewer__title">{paper.title}</h2>
        {renderError !== null ? (
          <p className="md-reviewer__render-error" role="alert">
            Markdown render failed: {renderError}
          </p>
        ) : null}
        <div className="md-reviewer__header-actions">
          <button
            type="button"
            className="md-reviewer__export"
            onClick={() => void onExport()}
            disabled={annotations.length === 0}
          >
            Export bundle ({annotations.length})
          </button>
          {exportStatus.kind === "saved" ? (
            <span className="md-reviewer__export-status">Saved to {exportStatus.relPath}</span>
          ) : exportStatus.kind === "error" ? (
            <span className="md-reviewer__export-status" data-kind="error" role="alert">
              {exportStatus.message}
            </span>
          ) : null}
        </div>
      </header>

      <div className="md-reviewer__body">
        <div className="md-reviewer__scroll">{documentView.content}</div>

        <aside className="md-reviewer__marks" aria-label="Marks">
          <h3 className="md-reviewer__marks-title">
            Marks <span className="md-reviewer__marks-count">{annotations.length}</span>
          </h3>
          {annotations.length === 0 ? (
            <p className="md-reviewer__marks-empty">
              Select a passage in the paper to draft your first mark.
            </p>
          ) : (
            <ol className="md-reviewer__marks-list">
              {annotations.map((row) => (
                <li key={row.id} className="md-reviewer__mark" data-category={row.category}>
                  <div className="md-reviewer__mark-head">
                    <span className="md-reviewer__mark-category">{row.category}</span>
                    {row.sourceAnchor ? (
                      <span className="md-reviewer__mark-loc">
                        L{row.sourceAnchor.lineStart}
                        {row.sourceAnchor.lineEnd !== row.sourceAnchor.lineStart
                          ? `–${row.sourceAnchor.lineEnd}`
                          : ""}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className="md-reviewer__mark-delete"
                      onClick={() => void deleteAnnotation(row.id)}
                      aria-label="Delete mark"
                    >
                      Delete
                    </button>
                  </div>
                  <blockquote className="md-reviewer__mark-quote">{row.quote}</blockquote>
                  {row.note.trim() !== "" ? (
                    <p className="md-reviewer__mark-note">{row.note}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>

      {selectedAnchor ? (
        <div className="md-reviewer__composer" role="dialog" aria-label="Draft a mark">
          <blockquote className="md-reviewer__composer-quote">{selectedAnchor.quote}</blockquote>
          <div className="md-reviewer__composer-controls">
            <label className="md-reviewer__composer-label">
              Category
              <select
                value={draftCategory ?? ""}
                onChange={(e) => setDraftCategory(e.target.value)}
                className="md-reviewer__composer-select"
              >
                <option value="" disabled>
                  Pick a category…
                </option>
                {categoryOptions()}
              </select>
            </label>
            <label className="md-reviewer__composer-label">
              Note
              <textarea
                value={draftNote}
                onChange={(e) => setDraftNote(e.target.value)}
                placeholder="What's the issue?"
                className="md-reviewer__composer-note"
                rows={3}
              />
            </label>
            <div className="md-reviewer__composer-actions">
              <button
                type="button"
                className="md-reviewer__composer-cancel"
                onClick={onCancelDraft}
              >
                Cancel
              </button>
              <button
                type="button"
                className="md-reviewer__composer-save"
                onClick={() => void onSaveMark()}
                disabled={draftCategory === null}
              >
                Save mark
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function categoryOptions(): JSX.Element[] {
  const cats: Array<{ id: string; label: string }> = [
    { id: "unclear", label: "unclear" },
    { id: "wrong", label: "wrong" },
    { id: "weak-argument", label: "weak argument" },
    { id: "citation-needed", label: "citation needed" },
    { id: "rephrase", label: "rephrase" },
    { id: "praise", label: "praise" },
    { id: "enhancement", label: "enhancement" },
    { id: "aside", label: "aside" },
    { id: "flag", label: "flag" },
  ];
  return cats.map((c) => (
    <option key={c.id} value={c.id}>
      {c.label}
    </option>
  ));
}
