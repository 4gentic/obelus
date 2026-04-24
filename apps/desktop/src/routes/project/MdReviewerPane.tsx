import { DEFAULT_CATEGORIES } from "@obelus/categories";
import {
  type MarkdownRenderStatus,
  type MarkdownSelection,
  MarkdownView,
  type MarkdownViewHandle,
  useMarkdownSelection,
} from "@obelus/md-view";
import "@obelus/md-view/md.css";
import type { AnnotationRow, PaperRow, RevisionRow } from "@obelus/repo";
import type { JSX } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { fsWriteBytes } from "../../ipc/commands";
import { exportMdBundleV2ForPaper } from "./build-bundle";
import { useProject } from "./context";
import "./md-reviewer-pane.css";

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

function nowIso(): string {
  return new Date().toISOString();
}

export default function MdReviewerPane({ path, text, paper, revision }: Props): JSX.Element {
  const { repo, rootId } = useProject();
  const [rows, setRows] = useState<AnnotationRow[]>([]);
  const [draft, setDraft] = useState<MarkdownSelection | null>(null);
  const [draftCategory, setDraftCategory] = useState<string>(
    DEFAULT_CATEGORIES[0]?.id ?? "unclear",
  );
  const [draftNote, setDraftNote] = useState("");
  const [renderError, setRenderError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<ExportStatus>({ kind: "idle" });
  const viewRef = useRef<MarkdownViewHandle | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const anns = await repo.annotations.listForRevision(revision.id);
      if (!cancelled) setRows(anns);
    })();
    return () => {
      cancelled = true;
    };
  }, [repo, revision.id]);

  const onRender = useCallback((status: MarkdownRenderStatus) => {
    setRenderError(status.kind === "parse-failed" ? status.error.kind : null);
    containerRef.current = viewRef.current?.getContainer() ?? null;
  }, []);

  useMarkdownSelection({
    containerRef,
    onSelection: (sel) => setDraft(sel),
  });

  const onSaveMark = useCallback(async () => {
    if (draft === null) return;
    const row: AnnotationRow = {
      id: crypto.randomUUID(),
      revisionId: revision.id,
      category: draftCategory,
      quote: draft.quote,
      contextBefore: draft.contextBefore,
      contextAfter: draft.contextAfter,
      sourceAnchor: {
        file: draft.anchor.file,
        lineStart: draft.anchor.lineStart,
        colStart: draft.anchor.colStart,
        lineEnd: draft.anchor.lineEnd,
        colEnd: draft.anchor.colEnd,
      },
      note: draftNote,
      thread: [],
      createdAt: nowIso(),
    };
    await repo.annotations.bulkPut(revision.id, [row]);
    setRows((prev) => [...prev, row]);
    setDraft(null);
    setDraftNote("");
    document.getSelection()?.removeAllRanges();
  }, [draft, draftCategory, draftNote, repo, revision.id]);

  const onCancelDraft = useCallback(() => {
    setDraft(null);
    setDraftNote("");
    document.getSelection()?.removeAllRanges();
  }, []);

  const onDeleteMark = useCallback(
    async (id: string) => {
      await repo.annotations.remove(id);
      setRows((prev) => prev.filter((r) => r.id !== id));
    },
    [repo],
  );

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
            disabled={rows.length === 0}
          >
            Export bundle ({rows.length})
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
        <div className="md-reviewer__scroll">
          <MarkdownView ref={viewRef} file={path} text={text} onRender={onRender} />
        </div>

        <aside className="md-reviewer__marks" aria-label="Marks">
          <h3 className="md-reviewer__marks-title">
            Marks <span className="md-reviewer__marks-count">{rows.length}</span>
          </h3>
          {rows.length === 0 ? (
            <p className="md-reviewer__marks-empty">
              Select a passage in the paper to draft your first mark.
            </p>
          ) : (
            <ol className="md-reviewer__marks-list">
              {rows.map((row) => (
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
                      onClick={() => void onDeleteMark(row.id)}
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

      {draft ? (
        <div className="md-reviewer__composer" role="dialog" aria-label="Draft a mark">
          <blockquote className="md-reviewer__composer-quote">{draft.quote}</blockquote>
          <div className="md-reviewer__composer-controls">
            <label className="md-reviewer__composer-label">
              Category
              <select
                value={draftCategory}
                onChange={(e) => setDraftCategory(e.target.value)}
                className="md-reviewer__composer-select"
              >
                {DEFAULT_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
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
