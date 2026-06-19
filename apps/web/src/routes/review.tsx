import { type MarksArchive, parseMarksArchive } from "@obelus/bundle-schema";
import type { ClassifyResult } from "@obelus/html-view";
import {
  buildMarksArchiveForExport,
  type ImportMode,
  runMarksImport,
} from "@obelus/marks-transfer";
import { loadDocument, usePdfDocumentView } from "@obelus/pdf-view";
import type { PaperRow, PaperRubric, RevisionRow } from "@obelus/repo";
import {
  annotations as annotationsRepo,
  getHtml,
  getMdText,
  getPdf,
  papers,
  revisions,
} from "@obelus/repo/web";
import type { DocumentView } from "@obelus/review-shell";
import "@obelus/review-shell/review-shell.css";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { type JSX, lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { buildBundle } from "../bundle/build";
import { copyClipboardPrompt, copyReviewClipboardPrompt } from "../bundle/clipboard";
import {
  exportBundleFile,
  exportBundleMarkdown,
  exportMarksArchiveFile,
  exportReviewBundleMarkdown,
} from "../bundle/download";
import { buildHtmlBundleJson, downloadHtmlBundle } from "../bundle/html-bundle";
import { buildMdBundleJson, downloadMdBundle } from "../bundle/md-bundle";
import { useReviewStore } from "../store/review-store";
import {
  type MarksReanchor,
  type PendingImport,
  ReviewBody,
  type ReviewContentProps,
  type Status,
} from "./ReviewBody";
import "./review.css";

// Markdown and HTML viewers pull heavy parsers (mdast / DOMPurify) plus their
// own CSS. Code-split them so the common PDF path never loads either: each
// renders through its own chunk fetched only when a paper of that format opens.
const MdReviewContent = lazy(() => import("./MdReviewContent"));
const HtmlReviewContent = lazy(() => import("./HtmlReviewContent"));

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
    }
  | {
      kind: "ready-html";
      paper: PaperRow;
      revision: RevisionRow;
      file: string;
      html: string;
    };

export default function Review(): JSX.Element {
  const { paperId } = useParams();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  // Filled by the lazy HtmlReviewContent once it classifies the paper; the
  // export flows read sourceFile from here. Reset per paper load below.
  const [htmlClassification, setHtmlClassification] = useState<ClassifyResult | null>(null);

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
    setHtmlClassification(null);
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
      if (paper.format === "html") {
        const html = await getHtml(paper.pdfSha256);
        if (html === null) {
          if (!cancelled) setState({ kind: "missing" });
          return;
        }
        const file = paper.entrypointRelPath ?? `${paper.title || "paper"}.html`;
        if (!cancelled) {
          setState({ kind: "ready-html", paper, revision, file, html });
        }
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
        prev.kind === "ready-pdf" || prev.kind === "ready-md" || prev.kind === "ready-html"
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
        if (prev.kind !== "ready-pdf" && prev.kind !== "ready-md" && prev.kind !== "ready-html") {
          return prev;
        }
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

  const onAnchor = useCallback(
    (draft: Parameters<typeof setSelectedAnchor>[0]): void => {
      setSelectedAnchor(draft);
    },
    [setSelectedAnchor],
  );
  const onDiscard = useCallback(() => setSelectedAnchor(null), [setSelectedAnchor]);
  const onUpdateNote = useCallback(
    (id: string, note: string) => updateAnnotation(id, { note }),
    [updateAnnotation],
  );
  const onUpdateCategory = useCallback(
    (id: string, category: string) => updateAnnotation(id, { category }),
    [updateAnnotation],
  );
  const onRenamePaperVoid = useCallback(
    (title: string) => void onRenamePaper(title),
    [onRenamePaper],
  );

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
  const htmlSourceFile =
    htmlClassification?.mode === "source" ? htmlClassification.sourceFile : undefined;

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
      } else if (state.kind === "ready-md") {
        name = await downloadMdBundle({ paper, revision, file: state.file }, kind);
      } else {
        name = await downloadHtmlBundle(
          {
            paper,
            revision,
            htmlFile: state.file,
            ...(htmlSourceFile !== undefined ? { sourceFile: htmlSourceFile } : {}),
          },
          kind,
        );
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

  const rubricForExport = paper?.rubric
    ? { label: paper.rubric.label, body: paper.rubric.body }
    : undefined;

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
        await exportBundleMarkdown(bundle, rubricForExport);
      } else if (state.kind === "ready-md") {
        const { bundle } = await buildMdBundleJson({ paper, revision, file: state.file });
        await exportBundleMarkdown(bundle, rubricForExport);
      } else {
        const { bundle } = await buildHtmlBundleJson({
          paper,
          revision,
          htmlFile: state.file,
          ...(htmlSourceFile !== undefined ? { sourceFile: htmlSourceFile } : {}),
        });
        await exportBundleMarkdown(bundle, rubricForExport);
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
        await copyClipboardPrompt(bundle, rubricForExport);
      } else if (state.kind === "ready-md") {
        const { bundle } = await buildMdBundleJson({ paper, revision, file: state.file });
        await copyClipboardPrompt(bundle, rubricForExport);
      } else {
        const { bundle } = await buildHtmlBundleJson({
          paper,
          revision,
          htmlFile: state.file,
          ...(htmlSourceFile !== undefined ? { sourceFile: htmlSourceFile } : {}),
        });
        await copyClipboardPrompt(bundle, rubricForExport);
      }
      setStatus("done");
      setMessage(rubricForExport ? "Prompt copied with rubric." : "Prompt copied to clipboard.");
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
        await copyReviewClipboardPrompt(bundle, rubricForExport);
      } else if (state.kind === "ready-md") {
        const { bundle } = await buildMdBundleJson({ paper, revision, file: state.file });
        await copyReviewClipboardPrompt(bundle, rubricForExport);
      } else {
        const { bundle } = await buildHtmlBundleJson({
          paper,
          revision,
          htmlFile: state.file,
          ...(htmlSourceFile !== undefined ? { sourceFile: htmlSourceFile } : {}),
        });
        await copyReviewClipboardPrompt(bundle, rubricForExport);
      }
      setStatus("done");
      setMessage(rubricForExport ? "Review prompt copied with rubric." : "Review prompt copied.");
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
        await exportReviewBundleMarkdown(bundle, rubricForExport);
      } else if (state.kind === "ready-md") {
        const { bundle } = await buildMdBundleJson({ paper, revision, file: state.file });
        await exportReviewBundleMarkdown(bundle, rubricForExport);
      } else {
        const { bundle } = await buildHtmlBundleJson({
          paper,
          revision,
          htmlFile: state.file,
          ...(htmlSourceFile !== undefined ? { sourceFile: htmlSourceFile } : {}),
        });
        await exportReviewBundleMarkdown(bundle, rubricForExport);
      }
      setStatus("done");
      setMessage("Review Markdown exported.");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Export failed");
    }
  };

  const onExportMarks = async (): Promise<string | null> => {
    setStatus("working");
    setMessage(null);
    try {
      const archive = buildMarksArchiveForExport({
        rows: annotations,
        format: paper.format,
        title: paper.title,
        pdfSha256: revision.pdfSha256,
        ...(state.kind === "ready-pdf" ? { pageCount: state.pageCount } : {}),
      });
      const name = await exportMarksArchiveFile(archive);
      if (name) {
        setStatus("done");
        setMessage(`Marks exported (${annotations.length}).`);
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

  const completeMarksImport = async (
    archive: MarksArchive,
    reanchor: MarksReanchor | undefined,
    mode: ImportMode,
    existing: number,
  ): Promise<void> => {
    setPendingImport(null);
    setStatus("working");
    setMessage(null);
    try {
      const { report, tone } = await runMarksImport({
        archive,
        writer: annotationsRepo,
        targetRevisionId: revision.id,
        targetPdfSha256: revision.pdfSha256,
        targetFormat: paper.format,
        mode,
        existingCount: existing,
        ...(reanchor ? { reanchor } : {}),
        newId: () => crypto.randomUUID(),
      });
      await load(revision.id);
      setStatus(tone);
      setMessage(report.message);
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Import failed");
    }
  };

  const beginMarksImport = async (
    file: File,
    reanchor: MarksReanchor | undefined,
  ): Promise<void> => {
    setStatus("working");
    setMessage(null);
    setPendingImport(null);
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      setStatus("error");
      setMessage("That file isn't valid JSON.");
      return;
    }
    const parsed = parseMarksArchive(raw);
    if (!parsed.ok) {
      setStatus("error");
      setMessage(`Not a marks archive — ${parsed.error}`);
      return;
    }
    try {
      const existing = (
        await annotationsRepo.listForRevision(revision.id, { includeResolved: true })
      ).length;
      if (existing === 0) {
        await completeMarksImport(parsed.archive, reanchor, "merge", 0);
        return;
      }
      setStatus("idle");
      setPendingImport({ archive: parsed.archive, reanchor, existing });
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Import failed");
    }
  };

  const onConfirmImport = (mode: ImportMode): void => {
    if (pendingImport) {
      void completeMarksImport(
        pendingImport.archive,
        pendingImport.reanchor,
        mode,
        pendingImport.existing,
      );
    }
  };

  const onCancelImport = (): void => {
    setPendingImport(null);
    setStatus("idle");
    setMessage(null);
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
      onDiscard={onDiscard}
      onUpdateNote={onUpdateNote}
      onUpdateCategory={onUpdateCategory}
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
        onExportMarks,
      }}
      runMarksImport={(file, reanchor) => void beginMarksImport(file, reanchor)}
      pendingImport={pendingImport}
      onConfirmImport={onConfirmImport}
      onCancelImport={onCancelImport}
      exportDisabled={status === "working"}
      onRenamePaper={onRenamePaperVoid}
      onRenderError={setRenderError}
      onHtmlClassified={setHtmlClassification}
    />
  );
}

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

// The PDF surface stays eager — it's the common case and the pdf-view chunk is
// already on the critical path. Markdown and HTML render through lazy chunks.
function PdfReviewContent(
  props: ReviewContentProps & {
    state: Extract<ReviewContentProps["state"], { kind: "ready-pdf" }>;
  },
): JSX.Element {
  const documentView = usePdfSurface(props, props.state);
  return <ReviewBody {...props} documentView={documentView} />;
}

function SurfaceLoading(): JSX.Element {
  return (
    <section className="review-shell review-shell--loading" aria-busy>
      <span className="review-shell__label">loading</span>
    </section>
  );
}

function ReviewContent(
  props: ReviewContentProps & { onHtmlClassified: (result: ClassifyResult) => void },
): JSX.Element {
  const { onHtmlClassified, ...rest } = props;
  if (rest.state.kind === "ready-pdf") {
    return <PdfReviewContent {...rest} state={rest.state} />;
  }
  if (rest.state.kind === "ready-md") {
    return (
      <Suspense fallback={<SurfaceLoading />}>
        <MdReviewContent {...rest} state={rest.state} />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={<SurfaceLoading />}>
      <HtmlReviewContent {...rest} state={rest.state} onClassified={onHtmlClassified} />
    </Suspense>
  );
}
