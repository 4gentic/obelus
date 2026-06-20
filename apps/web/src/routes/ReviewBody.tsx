import type { MarksArchive, MarksArchiveMark } from "@obelus/bundle-schema";
import type { ImportMode } from "@obelus/marks-transfer";
import type { AnchorFields, AnnotationRow, PaperRow, PaperRubric, RevisionRow } from "@obelus/repo";
import {
  type DocumentView,
  PageNavField,
  type PageNavProvider,
  ReviewPane,
  type ReviewPaneExports,
  ReviewShell,
  TrustBanner,
} from "@obelus/review-shell";
import type { DraftInput, ReviewState } from "@obelus/review-store";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { ChangeEvent, JSX } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { usePaperTrust } from "../store/use-paper-trust";

export type Status = "idle" | "working" | "done" | "error";

export type MarksReanchor = (mark: MarksArchiveMark) => Promise<AnchorFields | null>;

// A parsed archive held back while the reviewer decides replace-vs-merge, shown
// only when the paper already has marks.
export type PendingImport = {
  archive: MarksArchive;
  reanchor: MarksReanchor | undefined;
  existing: number;
};

export type ReviewContentProps = {
  state:
    | {
        kind: "ready-pdf";
        paper: PaperRow;
        revision: RevisionRow;
        doc: PDFDocumentProxy;
        pageCount: number;
      }
    | { kind: "ready-md"; paper: PaperRow; revision: RevisionRow; file: string; text: string }
    | {
        kind: "ready-html";
        paper: PaperRow;
        revision: RevisionRow;
        file: string;
        html: string;
      };
  annotations: AnnotationRow[];
  selectedAnchor: DraftInput | null;
  draftCategory: string | null;
  draftNote: string;
  focusedAnnotationId: string | null;
  status: Status;
  message: string | null;
  renderError: string | null;
  onAnchor: (draft: DraftInput | null) => void;
  onFocusMark: (id: string | null) => void;
  onSetDraftCategory: (c: string | null) => void;
  onSetDraftNote: (n: string) => void;
  onSave: ReviewState["saveAnnotation"];
  onDiscard: () => void;
  onUpdateNote: (id: string, note: string) => Promise<void>;
  onUpdateCategory: (id: string, c: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onDeleteGroup: (groupId: string) => Promise<void>;
  onRubricChange: (r: PaperRubric | null) => Promise<void>;
  exportsBundle: Omit<ReviewPaneExports, "onImportMarks">;
  runMarksImport: (file: File, reanchor: MarksReanchor | undefined) => void;
  pendingImport: PendingImport | null;
  onConfirmImport: (mode: ImportMode) => void;
  onCancelImport: () => void;
  exportDisabled: boolean;
  onRenamePaper: (title: string) => void;
  onRenderError: (message: string | null) => void;
};

export interface SurfaceTrustState {
  trusted: boolean;
  trust: () => void;
  blockedUris: ReadonlyArray<string>;
  onBlocked: (uri: string) => void;
  dismissed: boolean;
  dismiss: () => void;
}

export function useSurfaceTrust(paperId: string | null): SurfaceTrustState {
  const { trusted, trust } = usePaperTrust(paperId);
  const [blockedUris, setBlockedUris] = useState<ReadonlyArray<string>>([]);
  const [dismissed, setDismissed] = useState(false);
  const onBlocked = useCallback((uri: string) => {
    setBlockedUris((prev) => (prev.includes(uri) ? prev : [...prev, uri]));
  }, []);
  return {
    trusted,
    trust,
    blockedUris,
    onBlocked,
    dismissed,
    dismiss: useCallback(() => setDismissed(true), []),
  };
}

export function bannerFor(t: SurfaceTrustState): JSX.Element | null {
  if (t.trusted) return null;
  if (t.dismissed) return null;
  if (t.blockedUris.length === 0) return null;
  const hosts = uniqueHosts(t.blockedUris);
  return (
    <TrustBanner
      hosts={hosts}
      blockedCount={t.blockedUris.length}
      onTrust={t.trust}
      onDismiss={t.dismiss}
    />
  );
}

function uniqueHosts(uris: ReadonlyArray<string>): string[] {
  const out = new Set<string>();
  for (const uri of uris) {
    try {
      out.add(new URL(uri).host);
    } catch {
      // Non-URL violations (rare) are dropped — they aren't network egress.
    }
  }
  return Array.from(out);
}

export function ReviewBody(
  props: ReviewContentProps & { documentView: DocumentView },
): JSX.Element {
  const { state, documentView } = props;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const provider = documentView.reanchor;
  const reanchor: MarksReanchor | undefined = provider
    ? (mark) => provider.reanchor(mark)
    : undefined;
  const onMarksFile = (ev: ChangeEvent<HTMLInputElement>): void => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (file) props.runMarksImport(file, reanchor);
  };
  const exports: ReviewPaneExports = {
    ...props.exportsBundle,
    onImportMarks: () => fileInputRef.current?.click(),
  };
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
      onJumpToMark={(id) => {
        props.onFocusMark(id);
        documentView.scrollToAnnotation(id);
      }}
      onRubricChange={props.onRubricChange}
      exports={exports}
      exportDisabled={props.exportDisabled}
      statusMessage={props.message}
      statusTone={props.status}
      pendingImport={
        props.pendingImport
          ? {
              incoming: props.pendingImport.archive.marks.length,
              existing: props.pendingImport.existing,
              onReplace: () => props.onConfirmImport("replace"),
              onMerge: () => props.onConfirmImport("merge"),
              onCancel: props.onCancelImport,
            }
          : null
      }
    />
  );

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={onMarksFile}
      />
      {props.renderError !== null ? (
        <p className="review-crumb__render-error" role="alert">
          Render failed: {props.renderError}
        </p>
      ) : null}
      <ReviewShell
        label={`Review ${state.paper.id}`}
        header={
          <ReviewBreadcrumb
            paper={state.paper}
            onRename={props.onRenamePaper}
            pages={documentView.pages ?? null}
          />
        }
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
  pages: PageNavProvider | null;
};

const FORMAT_LABEL: Record<PaperRow["format"], string> = {
  pdf: "PDF",
  md: "Markdown",
  html: "HTML",
};

function ReviewBreadcrumb({ paper, onRename, pages }: ReviewBreadcrumbProps): JSX.Element {
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
      <div className="review-crumb__meta">
        <span className="review-crumb__format">{FORMAT_LABEL[paper.format]}</span>
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
            className="review-crumb__title review-crumb__title--editable"
            onClick={() => {
              setValue(paper.title);
              setEditing(true);
            }}
            aria-label={`Rename ${paper.title}`}
            title="Click to rename"
          >
            {paper.title}
          </button>
        )}
        {pages && pages.count > 1 ? (
          <PageNavField provider={pages} className="review-crumb__pagenav" />
        ) : null}
      </div>
    </nav>
  );
}
