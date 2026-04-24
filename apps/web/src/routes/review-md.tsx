import {
  type AnnotationV2Input,
  buildBundleV2,
  suggestBundleFilename,
} from "@obelus/bundle-builder";
import { DEFAULT_CATEGORIES } from "@obelus/categories";
import {
  MarkdownView,
  type MarkdownRenderStatus,
  type MarkdownSelection,
  type MarkdownViewHandle,
  useMarkdownSelection,
} from "@obelus/md-view";
import "@obelus/md-view/md.css";
import type { AnnotationRow, PaperRow, RevisionRow } from "@obelus/repo";
import { annotations, getMdText, papers, revisions } from "@obelus/repo/web";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import "./review-md.css";

import type { JSX } from "react";

type LoadState =
  | { kind: "loading" }
  | { kind: "missing" }
  | {
      kind: "ready";
      paper: PaperRow;
      revisionId: string;
      file: string;
      text: string;
    };

function uuid(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

export default function ReviewMd(): JSX.Element {
  const { paperId } = useParams();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [renderError, setRenderError] = useState<string | null>(null);
  const [rows, setRows] = useState<AnnotationRow[]>([]);
  const [draft, setDraft] = useState<MarkdownSelection | null>(null);
  const [draftCategory, setDraftCategory] = useState<string>(DEFAULT_CATEGORIES[0]?.id ?? "unclear");
  const [draftNote, setDraftNote] = useState("");
  const viewRef = useRef<MarkdownViewHandle | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run(): Promise<void> {
      if (!paperId) {
        if (!cancelled) setState({ kind: "missing" });
        return;
      }
      const paper = await papers.get(paperId);
      if (!paper || paper.format !== "md") {
        if (!cancelled) setState({ kind: "missing" });
        return;
      }
      const text = await getMdText(paper.pdfSha256);
      if (text === null) {
        if (!cancelled) setState({ kind: "missing" });
        return;
      }
      const file = paper.entrypointRelPath ?? `${paper.title || "paper"}.md`;
      const revList = await revisions.listForPaper(paper.id);
      const revId = revList.at(-1)?.id;
      if (!revId) {
        if (!cancelled) setState({ kind: "missing" });
        return;
      }
      const anns = await annotations.listForRevision(revId);
      if (!cancelled) {
        setState({ kind: "ready", paper, revisionId: revId, file, text });
        setRows(anns);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [paperId]);

  const onRender = useCallback((status: MarkdownRenderStatus) => {
    setRenderError(status.kind === "parse-failed" ? status.error.kind : null);
    const container = viewRef.current?.getContainer() ?? null;
    containerRef.current = container;
  }, []);

  useMarkdownSelection({
    containerRef,
    onSelection: (sel) => setDraft(sel),
  });

  const onSaveMark = useCallback(async () => {
    if (state.kind !== "ready" || draft === null) return;
    const row: AnnotationRow = {
      id: uuid(),
      revisionId: state.revisionId,
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
    await annotations.bulkPut(state.revisionId, [row]);
    setRows((prev) => [...prev, row]);
    setDraft(null);
    setDraftNote("");
    document.getSelection()?.removeAllRanges();
  }, [draft, draftCategory, draftNote, state]);

  const onCancelDraft = useCallback(() => {
    setDraft(null);
    setDraftNote("");
    document.getSelection()?.removeAllRanges();
  }, []);

  const onDeleteMark = useCallback(async (id: string) => {
    await annotations.remove(id);
    setRows((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const [exportError, setExportError] = useState<string | null>(null);
  const onExport = useCallback(async () => {
    if (state.kind !== "ready") return;
    if (rows.length === 0) {
      setExportError("No marks to export yet.");
      return;
    }
    setExportError(null);
    const revList = await revisions.listForPaper(state.paper.id);
    const revision: RevisionRow | undefined = revList.at(-1);
    if (!revision) {
      setExportError("Paper has no revision.");
      return;
    }
    const v2Annotations: AnnotationV2Input[] = rows.flatMap((r) => {
      if (r.sourceAnchor === undefined) return [];
      return [
        {
          id: r.id,
          paperId: state.paper.id,
          category: r.category,
          quote: r.quote,
          contextBefore: r.contextBefore,
          contextAfter: r.contextAfter,
          sourceAnchor: r.sourceAnchor,
          note: r.note,
          thread: r.thread,
          createdAt: r.createdAt,
          ...(r.groupId !== undefined ? { groupId: r.groupId } : {}),
        },
      ];
    });
    const bundle = buildBundleV2({
      project: {
        // The web app has no project concept; fold the single paper into a
        // synthetic project so the bundle validates against BundleV2 and the
        // plugin's apply-revision skill treats it like any other reviewer job.
        id: state.paper.id,
        label: state.paper.title,
        kind: "reviewer",
        categories: DEFAULT_CATEGORIES.map((c) => ({ slug: c.id, label: c.label })),
        main: state.file,
      },
      papers: [
        {
          id: state.paper.id,
          title: state.paper.title,
          revisionNumber: revision.revisionNumber,
          createdAt: revision.createdAt,
          entrypoint: state.file,
        },
      ],
      annotations: v2Annotations,
    });
    const json = JSON.stringify(bundle, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const filename = suggestBundleFilename("review");
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    console.info("[export-bundle-md]", {
      paperId: state.paper.id,
      annotationCount: v2Annotations.length,
      droppedForMissingAnchor: rows.length - v2Annotations.length,
      filename,
    });
  }, [rows, state]);

  if (state.kind === "loading") {
    return (
      <section className="review-md review-md--loading" aria-busy>
        <p>Opening paper…</p>
      </section>
    );
  }
  if (state.kind === "missing") {
    return (
      <section className="review-md review-md--missing" role="alert">
        <p>This paper is not available.</p>
        <Link to="/app" className="review-md__back">
          Back to library
        </Link>
      </section>
    );
  }

  return (
    <section className="review-md">
      <header className="review-md__header">
        <Link to="/app" className="review-md__back">
          &larr; Library
        </Link>
        <h1 className="review-md__title">{state.paper.title}</h1>
        {renderError !== null ? (
          <p className="review-md__render-error" role="alert">
            Markdown render failed: {renderError}
          </p>
        ) : null}
        <div className="review-md__header-actions">
          <button
            type="button"
            className="review-md__export"
            onClick={() => void onExport()}
            disabled={rows.length === 0}
          >
            Export bundle ({rows.length})
          </button>
          {exportError !== null ? (
            <span className="review-md__export-error" role="alert">
              {exportError}
            </span>
          ) : null}
        </div>
      </header>

      <div className="review-md__body">
        <div className="review-md__scroll">
          <MarkdownView ref={viewRef} file={state.file} text={state.text} onRender={onRender} />
        </div>

        <aside className="review-md__marks" aria-label="Marks">
          <h2 className="review-md__marks-title">
            Marks <span className="review-md__marks-count">{rows.length}</span>
          </h2>
          {rows.length === 0 ? (
            <p className="review-md__marks-empty">
              Select a passage in the paper to draft your first mark.
            </p>
          ) : (
            <ol className="review-md__marks-list">
              {rows.map((row) => (
                <li key={row.id} className="review-md__mark" data-category={row.category}>
                  <div className="review-md__mark-head">
                    <span className="review-md__mark-category">{row.category}</span>
                    {row.sourceAnchor ? (
                      <span className="review-md__mark-loc">
                        L{row.sourceAnchor.lineStart}
                        {row.sourceAnchor.lineEnd !== row.sourceAnchor.lineStart
                          ? `–${row.sourceAnchor.lineEnd}`
                          : ""}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className="review-md__mark-delete"
                      onClick={() => void onDeleteMark(row.id)}
                      aria-label="Delete mark"
                    >
                      Delete
                    </button>
                  </div>
                  <blockquote className="review-md__mark-quote">{row.quote}</blockquote>
                  {row.note.trim() !== "" ? (
                    <p className="review-md__mark-note">{row.note}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>

      {draft ? (
        <div className="review-md__composer" role="dialog" aria-label="Draft a mark">
          <blockquote className="review-md__composer-quote">{draft.quote}</blockquote>
          <div className="review-md__composer-controls">
            <label className="review-md__composer-label">
              Category
              <select
                value={draftCategory}
                onChange={(e) => setDraftCategory(e.target.value)}
                className="review-md__composer-select"
              >
                {DEFAULT_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="review-md__composer-label review-md__composer-label--note">
              Note
              <textarea
                value={draftNote}
                onChange={(e) => setDraftNote(e.target.value)}
                placeholder="What's the issue?"
                className="review-md__composer-note"
                rows={3}
              />
            </label>
            <div className="review-md__composer-actions">
              <button
                type="button"
                className="review-md__composer-cancel"
                onClick={onCancelDraft}
              >
                Cancel
              </button>
              <button
                type="button"
                className="review-md__composer-save"
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
