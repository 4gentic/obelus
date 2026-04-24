import { useMdDocumentView } from "@obelus/md-view";
import "@obelus/md-view/md.css";
import { loadDocument, usePdfDocumentView } from "@obelus/pdf-view";
import type { PaperRow, PaperRubric, RevisionRow } from "@obelus/repo";
import { getMdText, getPdf, papers, revisions } from "@obelus/repo/web";
import { type DocumentView, ReviewPane, ReviewShell } from "@obelus/review-shell";
import "@obelus/review-shell/review-shell.css";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { buildBundle } from "../bundle/build";
import { copyClipboardPrompt, copyReviewClipboardPrompt } from "../bundle/clipboard";
import {
  exportBundleFile,
  exportBundleMarkdown,
  exportReviewBundleMarkdown,
} from "../bundle/download";
import { downloadMdBundle } from "../bundle/md-bundle";
import { useReviewStore } from "../store/review-store";
import "./review.css";

import type { JSX } from "react";

type Status = "idle" | "working" | "done" | "error";

type LoadState =
  | { kind: "loading" }
  | { kind: "missing" }
  | {
      kind: "ready-pdf";
      paper: PaperRow;
      revision: RevisionRow;
      doc: PDFDocumentProxy;
      pageCount: number;
    }
  | {
      kind: "ready-md";
      paper: PaperRow;
      revision: RevisionRow;
      file: string;
      text: string;
    };

export default function Review(): JSX.Element {
  const { paperId } = useParams();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  const annotations = useReviewStore((s) => s.annotations);
  const selectedAnchor = useReviewStore((s) => s.selectedAnchor);
  const draftCategory = useReviewStore((s) => s.draftCategory);
  const draftNote = useReviewStore((s) => s.draftNote);
  const focusedAnnotationId = useReviewStore((s) => s.focusedAnnotationId);
  const load = useReviewStore((s) => s.load);
  const setSelectedAnchor = useReviewStore((s) => s.setSelectedAnchor);
  const setDraftCategory = useReviewStore((s) => s.setDraftCategory);
  const setDraftNote = useReviewStore((s) => s.setDraftNote);
  const setFocusedAnnotation = useReviewStore((s) => s.setFocusedAnnotation);
  const saveAnnotation = useReviewStore((s) => s.saveAnnotation);
  const updateAnnotation = useReviewStore((s) => s.updateAnnotation);
  const deleteAnnotation = useReviewStore((s) => s.deleteAnnotation);
  const deleteGroup = useReviewStore((s) => s.deleteGroup);

  useEffect(() => {
    let cancelled = false;
    async function run(): Promise<void> {
      if (!paperId) {
        if (!cancelled) setState({ kind: "missing" });
        return;
      }
      const paper = await papers.get(paperId);
      if (!paper) {
        if (!cancelled) setState({ kind: "missing" });
        return;
      }
      const revList = await revisions.listForPaper(paper.id);
      const revision = revList.at(-1);
      if (!revision) {
        if (!cancelled) setState({ kind: "missing" });
        return;
      }
      await load(revision.id);
      if (paper.format === "md") {
        const text = await getMdText(paper.pdfSha256);
        if (text === null) {
          if (!cancelled) setState({ kind: "missing" });
          return;
        }
        const file = paper.entrypointRelPath ?? `${paper.title || "paper"}.md`;
        if (!cancelled) setState({ kind: "ready-md", paper, revision, file, text });
        return;
      }
      const bytes = await getPdf(paper.pdfSha256);
      if (!bytes) {
        if (!cancelled) setState({ kind: "missing" });
        return;
      }
      const doc = await loadDocument(bytes);
      if (!cancelled) {
        setState({ kind: "ready-pdf", paper, revision, doc, pageCount: doc.numPages });
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [paperId, load]);

  const onRenamePaper = useCallback(
    async (title: string) => {
      if (!paperId) return;
      await papers.rename(paperId, title);
      setState((prev) =>
        prev.kind === "ready-pdf" || prev.kind === "ready-md"
          ? {
              ...prev,
              paper: { ...prev.paper, title: title.trim() || "Untitled" },
            }
          : prev,
      );
    },
    [paperId],
  );

  const onRubricChange = useCallback(
    async (next: PaperRubric | null): Promise<void> => {
      if (!paperId) return;
      await papers.setRubric(paperId, next);
      setState((prev) => {
        if (prev.kind !== "ready-pdf" && prev.kind !== "ready-md") return prev;
        if (next === null) {
          const { rubric: _drop, ...rest } = prev.paper;
          return { ...prev, paper: rest };
        }
        return { ...prev, paper: { ...prev.paper, rubric: next } };
      });
    },
    [paperId],
  );

  useEffect(() => {
    if (!selectedAnchor) return;
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      setSelectedAnchor(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedAnchor, setSelectedAnchor]);

  if (state.kind === "loading") {
    return (
      <section className="review-shell review-shell--loading" aria-busy>
        <span className="review-shell__label">loading</span>
      </section>
    );
  }
  if (state.kind === "missing") {
    return (
      <section className="review-shell review-shell--missing" role="alert">
        <p>This paper is not available.</p>
        <Link to="/app" className="review-crumb__back">
          Back to library
        </Link>
      </section>
    );
  }

  const paper = state.paper;
  const revision = state.revision;
  const pageCount = state.kind === "ready-pdf" ? state.pageCount : 1;

  const onAnchor = (draft: Parameters<typeof setSelectedAnchor>[0]): void => {
    setSelectedAnchor(draft);
  };

  // Export handlers dispatch on paper.format. PDF papers ride the existing
  // v1 Bundle flow; MD papers build a V2 bundle with sourceAnchor-carrying
  // annotations and download JSON (clipboard/markdown paths reuse the JSON
  // for now — V2 prompt formatting lands in a follow-up).
  const exportBundleForKind = async (kind: "review" | "revise"): Promise<string | null> => {
    setStatus("working");
    setMessage(null);
    try {
      let name: string | null = null;
      if (state.kind === "ready-pdf") {
        const bundle = await buildBundle({
          paperId: paper.id,
          revisionId: revision.id,
          pdfFilename: "paper.pdf",
          pageCount: pageCount || 1,
        });
        name = await exportBundleFile(bundle, kind);
      } else {
        name = await downloadMdBundle({ paper, revision, file: state.file }, kind);
      }
      if (name) {
        setStatus("done");
        setMessage("Bundle exported.");
      } else {
        setStatus("idle");
      }
      return name;
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Export failed");
      return null;
    }
  };

  const onExportMarkdown = async (): Promise<void> => {
    setStatus("working");
    setMessage(null);
    try {
      if (state.kind === "ready-pdf") {
        const bundle = await buildBundle({
          paperId: paper.id,
          revisionId: revision.id,
          pdfFilename: "paper.pdf",
          pageCount: pageCount || 1,
        });
        await exportBundleMarkdown(bundle);
      } else {
        await downloadMdBundle({ paper, revision, file: state.file }, "revise");
      }
      setStatus("done");
      setMessage("Markdown exported.");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Export failed");
    }
  };

  const onCopy = async (): Promise<void> => {
    setStatus("working");
    setMessage(null);
    try {
      if (state.kind === "ready-pdf") {
        const bundle = await buildBundle({
          paperId: paper.id,
          revisionId: revision.id,
          pdfFilename: "paper.pdf",
          pageCount: pageCount || 1,
        });
        await copyClipboardPrompt(bundle);
        setStatus("done");
        setMessage("Prompt copied to clipboard.");
      } else {
        await downloadMdBundle({ paper, revision, file: state.file }, "revise");
        setStatus("done");
        setMessage("Bundle exported (MD prompt formatter coming soon).");
      }
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Copy failed");
    }
  };

  const onCopyReview = async (): Promise<void> => {
    setStatus("working");
    setMessage(null);
    try {
      if (state.kind === "ready-pdf") {
        const bundle = await buildBundle({
          paperId: paper.id,
          revisionId: revision.id,
          pdfFilename: "paper.pdf",
          pageCount: pageCount || 1,
        });
        const rubric = paper.rubric
          ? { label: paper.rubric.label, body: paper.rubric.body }
          : undefined;
        await copyReviewClipboardPrompt(bundle, rubric);
        setStatus("done");
        setMessage(rubric ? "Review prompt copied with rubric." : "Review prompt copied.");
      } else {
        await downloadMdBundle({ paper, revision, file: state.file }, "review");
        setStatus("done");
        setMessage("Bundle exported (MD prompt formatter coming soon).");
      }
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Copy failed");
    }
  };

  const onExportReviewMarkdown = async (): Promise<void> => {
    setStatus("working");
    setMessage(null);
    try {
      if (state.kind === "ready-pdf") {
        const bundle = await buildBundle({
          paperId: paper.id,
          revisionId: revision.id,
          pdfFilename: "paper.pdf",
          pageCount: pageCount || 1,
        });
        const rubric = paper.rubric
          ? { label: paper.rubric.label, body: paper.rubric.body }
          : undefined;
        await exportReviewBundleMarkdown(bundle, rubric);
      } else {
        await downloadMdBundle({ paper, revision, file: state.file }, "review");
      }
      setStatus("done");
      setMessage("Review Markdown exported.");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Export failed");
    }
  };

  return (
    <ReviewContent
      state={state}
      annotations={annotations}
      selectedAnchor={selectedAnchor}
      draftCategory={draftCategory}
      draftNote={draftNote}
      focusedAnnotationId={focusedAnnotationId}
      status={status}
      message={message}
      renderError={renderError}
      onAnchor={onAnchor}
      onFocusMark={setFocusedAnnotation}
      onSetDraftCategory={setDraftCategory}
      onSetDraftNote={setDraftNote}
      onSave={saveAnnotation}
      onDiscard={() => setSelectedAnchor(null)}
      onUpdateNote={(id, note) => updateAnnotation(id, { note })}
      onUpdateCategory={(id, category) => updateAnnotation(id, { category })}
      onDelete={deleteAnnotation}
      onDeleteGroup={deleteGroup}
      onRubricChange={onRubricChange}
      exportsBundle={{
        onExportReview: () => exportBundleForKind("review"),
        onExportRevise: () => exportBundleForKind("revise"),
        onExportMarkdown: () => void onExportMarkdown(),
        onExportReviewMarkdown: () => void onExportReviewMarkdown(),
        onCopy: () => void onCopy(),
        onCopyReview: () => void onCopyReview(),
      }}
      exportDisabled={status === "working"}
      onRenamePaper={(t) => void onRenamePaper(t)}
      onRenderError={setRenderError}
    />
  );
}

type ReviewContentProps = {
  state:
    | {
        kind: "ready-pdf";
        paper: PaperRow;
        revision: RevisionRow;
        doc: PDFDocumentProxy;
        pageCount: number;
      }
    | { kind: "ready-md"; paper: PaperRow; revision: RevisionRow; file: string; text: string };
  annotations: ReturnType<typeof useReviewStore.getState> extends { annotations: infer A }
    ? A
    : never;
  selectedAnchor: ReturnType<typeof useReviewStore.getState>["selectedAnchor"];
  draftCategory: string | null;
  draftNote: string;
  focusedAnnotationId: string | null;
  status: Status;
  message: string | null;
  renderError: string | null;
  onAnchor: (draft: ReturnType<typeof useReviewStore.getState>["selectedAnchor"]) => void;
  onFocusMark: (id: string | null) => void;
  onSetDraftCategory: (c: string | null) => void;
  onSetDraftNote: (n: string) => void;
  onSave: ReturnType<typeof useReviewStore.getState>["saveAnnotation"];
  onDiscard: () => void;
  onUpdateNote: (id: string, note: string) => Promise<void>;
  onUpdateCategory: (id: string, c: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onDeleteGroup: (groupId: string) => Promise<void>;
  onRubricChange: (r: PaperRubric | null) => Promise<void>;
  exportsBundle: import("@obelus/review-shell").ReviewPaneExports;
  exportDisabled: boolean;
  onRenamePaper: (title: string) => void;
  onRenderError: (message: string | null) => void;
};

function usePdfSurface(
  props: ReviewContentProps,
  state: Extract<ReviewContentProps["state"], { kind: "ready-pdf" }>,
): DocumentView {
  return usePdfDocumentView({
    doc: state.doc,
    annotations: props.annotations,
    selectedAnchor: props.selectedAnchor,
    draftCategory: props.draftCategory,
    focusedId: props.focusedAnnotationId,
    onAnchor: props.onAnchor,
    onFocusMark: props.onFocusMark,
  });
}

function useMdSurface(
  props: ReviewContentProps,
  state: Extract<ReviewContentProps["state"], { kind: "ready-md" }>,
): DocumentView {
  return useMdDocumentView({
    file: state.file,
    text: state.text,
    annotations: props.annotations,
    selectedAnchor: props.selectedAnchor,
    draftCategory: props.draftCategory,
    focusedId: props.focusedAnnotationId,
    onAnchor: props.onAnchor,
    onRenderError: props.onRenderError,
  });
}

function PdfReviewContent(
  props: ReviewContentProps & {
    state: Extract<ReviewContentProps["state"], { kind: "ready-pdf" }>;
  },
): JSX.Element {
  const documentView = usePdfSurface(props, props.state);
  return <ReviewBody {...props} documentView={documentView} />;
}

function MdReviewContent(
  props: ReviewContentProps & {
    state: Extract<ReviewContentProps["state"], { kind: "ready-md" }>;
  },
): JSX.Element {
  const documentView = useMdSurface(props, props.state);
  return <ReviewBody {...props} documentView={documentView} />;
}

function ReviewContent(props: ReviewContentProps): JSX.Element {
  if (props.state.kind === "ready-pdf") {
    return <PdfReviewContent {...props} state={props.state} />;
  }
  return <MdReviewContent {...props} state={props.state} />;
}

function ReviewBody(props: ReviewContentProps & { documentView: DocumentView }): JSX.Element {
  const { state, documentView } = props;
  const pane = (
    <ReviewPane
      annotations={props.annotations}
      selectedAnchor={props.selectedAnchor}
      draftCategory={props.draftCategory}
      draftNote={props.draftNote}
      focusedAnnotationId={props.focusedAnnotationId}
      rubric={state.paper.rubric ?? null}
      onSave={props.onSave}
      onDiscard={props.onDiscard}
      onDraftCategoryChange={props.onSetDraftCategory}
      onDraftNoteChange={props.onSetDraftNote}
      onUpdateNote={props.onUpdateNote}
      onUpdateCategory={props.onUpdateCategory}
      onDelete={props.onDelete}
      onDeleteGroup={props.onDeleteGroup}
      onRubricChange={props.onRubricChange}
      exports={props.exportsBundle}
      exportDisabled={props.exportDisabled}
      statusMessage={props.message}
      statusTone={props.status}
    />
  );

  return (
    <>
      {props.renderError !== null ? (
        <p className="review-crumb__render-error" role="alert">
          Markdown render failed: {props.renderError}
        </p>
      ) : null}
      <ReviewShell
        label={`Review ${state.paper.id}`}
        header={<ReviewBreadcrumb paper={state.paper} onRename={props.onRenamePaper} />}
        documentView={documentView}
        annotations={props.annotations}
        pane={pane}
        draftOpen={props.selectedAnchor !== null}
        onFocusMark={(id) => props.onFocusMark(id)}
      />
    </>
  );
}

type ReviewBreadcrumbProps = {
  paper: PaperRow;
  onRename: (title: string) => void;
};

function ReviewBreadcrumb({ paper, onRename }: ReviewBreadcrumbProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function commit(): void {
    const next = value.trim() || "Untitled";
    if (next !== paper.title) onRename(next);
    setEditing(false);
  }

  function cancel(): void {
    setEditing(false);
  }

  return (
    <nav className="review-crumb" aria-label="Paper">
      <Link to="/app" className="review-crumb__back">
        <span aria-hidden="true">←</span> Library
      </Link>
      {editing ? (
        <input
          ref={inputRef}
          className="review-crumb__input"
          type="text"
          value={value}
          aria-label="Paper title"
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="review-crumb__title"
          onClick={() => {
            setValue(paper.title);
            setEditing(true);
          }}
          aria-label={`Rename ${paper.title}`}
        >
          {paper.title}
        </button>
      )}
    </nav>
  );
}
