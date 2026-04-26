import { openSearchPanel } from "@codemirror/search";
import type { CSSProperties, JSX } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OPEN_FILE_EVENT, type OpenFileEventDetail } from "../../lib/open-file-event";
import { getActiveSourceView } from "./active-source-view";
import { useBuffersStore } from "./buffers-store-context";
import CenterPane from "./CenterPane";
import { useProject } from "./context";
import { EnsureRevisionProvider } from "./ensure-revision-context";
import FilesColumn from "./FilesColumn";
import FindBar from "./FindBar";
import { findOrCreatePaper } from "./find-or-create-paper";
import { useFindStore } from "./find-store-context";
import { type PaneWidths, useProjectLayout } from "./layout-store";
import MarginGutter from "./MarginGutter";
import { useOpenPaper, useRefreshOpenPaper } from "./OpenPaper";
import PaneDivider from "./PaneDivider";
import QuickOpenPalette from "./QuickOpenPalette";
import { useQuickOpenStore } from "./quick-open-store-context";
import ReviewColumn from "./ReviewColumn";
import { useReviewStore } from "./store-context";
import { useDiffActions } from "./use-diff-actions";
import { useWorkingTreeDivergence } from "./use-divergence";
import { useExternalChangeWatcher } from "./use-external-change-watcher";
import { useLoadRevision } from "./use-load-revision";
import { usePaperEdits } from "./use-paper-edits";

export default function ProjectShell(): JSX.Element {
  const { project, repo, rootId, setOpenFilePath } = useProject();
  const buffers = useBuffersStore();
  const openPaper = useOpenPaper();
  const refreshOpenPaper = useRefreshOpenPaper();
  const paperId = openPaper.kind === "ready" ? openPaper.paper.id : null;
  useLoadRevision();
  useExternalChangeWatcher();

  useEffect(() => {
    const onOpen = (ev: Event): void => {
      const detail = (ev as CustomEvent<OpenFileEventDetail>).detail;
      if (!detail || detail.projectId !== project.id) return;
      const proceed = buffers.getState().requestSwitch(detail.relPath);
      if (proceed) setOpenFilePath(detail.relPath);
    };
    window.addEventListener(OPEN_FILE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_FILE_EVENT, onOpen);
  }, [project.id, buffers, setOpenFilePath]);
  const { apply, repass, discard, forkInfo } = useDiffActions();
  const reviewStore = useReviewStore();
  const edits = usePaperEdits(repo, paperId);
  const currentDraft = useMemo(
    () => edits.live.find((e) => e.id === edits.currentDraftId),
    [edits.live, edits.currentDraftId],
  );
  const divergence = useWorkingTreeDivergence(rootId, project.id, currentDraft);
  const findStore = useFindStore();
  const quickOpenStore = useQuickOpenStore();
  const pdfOpen = openPaper.kind === "ready";

  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      // Cmd/Ctrl+P: open the file palette. Quick open is global — it takes
      // precedence over whatever editor / pane has focus. Re-pressing while
      // the palette is already open is a no-op so the user's in-progress
      // query is preserved.
      if (
        (ev.metaKey || ev.ctrlKey) &&
        !ev.shiftKey &&
        !ev.altKey &&
        ev.key.toLowerCase() === "p"
      ) {
        ev.preventDefault();
        const state = quickOpenStore.getState();
        if (!state.isOpen) state.open();
        return;
      }

      // Cmd/Ctrl+F: route to CodeMirror when a source editor is mounted; open
      // the PDF find bar otherwise. When the event originates inside a
      // CodeMirror editor, its own `searchKeymap` already handled it — bail
      // out so we don't fire twice.
      if (
        (ev.metaKey || ev.ctrlKey) &&
        !ev.shiftKey &&
        !ev.altKey &&
        ev.key.toLowerCase() === "f"
      ) {
        const target = ev.target as HTMLElement | null;
        if (target?.closest(".cm-editor")) return;
        const view = getActiveSourceView();
        if (view) {
          ev.preventDefault();
          view.focus();
          openSearchPanel(view);
          return;
        }
        if (pdfOpen) {
          ev.preventDefault();
          findStore.getState().open();
        }
        return;
      }

      if (ev.key !== "Escape") return;
      const target = ev.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
          // Let the FindBar input handle its own Escape to close; other inputs
          // keep their native behavior.
          if (!target.closest(".find-bar")) return;
        } else if (target.isContentEditable) {
          return;
        }
      }
      if (findStore.getState().isOpen) {
        ev.preventDefault();
        findStore.getState().close();
        return;
      }
      const state = reviewStore.getState();
      if (state.selectedAnchor || state.focusedAnnotationId) {
        ev.preventDefault();
        state.setSelectedAnchor(null);
        state.setFocusedAnnotation(null);
        window.getSelection()?.removeAllRanges();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reviewStore, findStore, quickOpenStore, pdfOpen]);

  // Writer-mode MD/HTML papers don't get a `papers` row until their first mark.
  // `ReviewDraft` (mounted in `ReviewColumn`, a sibling subtree of `CenterPane`)
  // needs this callback via context so the first save materializes paper +
  // revision on demand. The provider has to live here — up-tree of both
  // subtrees — so the context actually reaches the consumer.
  const lazyEnsureRevision = useMemo(() => {
    const isLazyMd = openPaper.kind === "ready-md" && openPaper.paper === null;
    const isLazyHtml = openPaper.kind === "ready-html" && openPaper.paper === null;
    if (!isLazyMd && !isLazyHtml) return null;
    const relPath = openPaper.path;
    const format = isLazyMd ? "md" : "html";
    return async (): Promise<{ paperId: string; revisionId: string }> => {
      const { paper, revision } = await findOrCreatePaper({
        repo,
        projectId: project.id,
        rootId,
        relPath,
        format,
        pageCount: 0,
      });
      refreshOpenPaper();
      return { paperId: paper.id, revisionId: revision.id };
    };
  }, [openPaper, repo, project.id, rootId, refreshOpenPaper]);

  const hideLeft = project.kind === "reviewer";
  const noPdf = openPaper.kind === "none";
  const classes = ["project-shell__body"];
  if (noPdf) classes.push("project-shell__body--no-pdf");
  if (hideLeft) classes.push("project-shell__body--no-left");
  const bodyClass = classes.join(" ");

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [bodyWidth, setBodyWidth] = useState(0);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    setBodyWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(() => {
      if (el.isConnected) setBodyWidth(el.getBoundingClientRect().width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { widths, setWidth } = useProjectLayout(project.id);
  const onFilesResize = useCallback(
    (v: number, measured: PaneWidths) => setWidth("files", v, measured),
    [setWidth],
  );
  const onMarginResize = useCallback(
    (v: number, measured: PaneWidths) => setWidth("margin", v, measured),
    [setWidth],
  );
  const onReviewResize = useCallback(
    (v: number, measured: PaneWidths) => setWidth("review", v, measured),
    [setWidth],
  );

  // Drag only takes effect in layouts that expose the fixed-width columns.
  // Below 1024 the layout compacts; when --no-pdf is active the margin gutter
  // collapses and the review pane hides, so user-dragged widths are ignored
  // until the state clears.
  const dragApplies = !noPdf && bodyWidth >= 1024;
  const showFilesDivider = dragApplies && !hideLeft;
  const showMarginDivider = dragApplies && bodyWidth >= 1280;
  const showReviewDivider = dragApplies;

  const bodyStyle: CSSProperties | undefined =
    widths && dragApplies
      ? { gridTemplateColumns: composeGridColumns({ hideLeft, bodyWidth, widths }) }
      : undefined;

  return (
    <div className="project-shell">
      <header className="project-shell__header">
        <h1 className="project-shell__title">{project.label}</h1>
        <code className="project-shell__root">{project.root}</code>
      </header>
      {divergence.dirty && divergence.report !== null && (
        <DivergenceBanner report={divergence.report} currentOrdinal={divergence.currentOrdinal} />
      )}
      <EnsureRevisionProvider value={lazyEnsureRevision}>
        <div className={bodyClass} ref={bodyRef} style={bodyStyle}>
          {project.kind === "writer" ? (
            <div className="project-shell__files">
              <FilesColumn />
              {showFilesDivider ? (
                <PaneDivider
                  side="files"
                  bodyRef={bodyRef}
                  hideLeft={hideLeft}
                  valueNow={widths?.filesWidth}
                  onChange={onFilesResize}
                />
              ) : null}
            </div>
          ) : null}
          <main className="project-shell__center">
            <div className="find-bar-anchor">
              <FindBar />
            </div>
            <div className="quick-open-anchor">
              <QuickOpenPalette />
            </div>
            <CenterPane />
          </main>
          <div className="project-shell__margin">
            {showMarginDivider ? (
              <PaneDivider
                side="margin"
                bodyRef={bodyRef}
                hideLeft={hideLeft}
                valueNow={widths?.marginWidth}
                onChange={onMarginResize}
              />
            ) : null}
            <div className="project-shell__margin-scroll">
              <MarginGutter />
            </div>
          </div>
          <div className="project-shell__review">
            {showReviewDivider ? (
              <PaneDivider
                side="review"
                bodyRef={bodyRef}
                hideLeft={hideLeft}
                valueNow={widths?.reviewWidth}
                onChange={onReviewResize}
              />
            ) : null}
            <div className="project-shell__review-scroll">
              <ReviewColumn
                onApply={apply}
                onRepass={repass}
                onDiscard={discard}
                forkInfo={forkInfo}
              />
            </div>
          </div>
        </div>
      </EnsureRevisionProvider>
    </div>
  );
}

interface ComposeArgs {
  hideLeft: boolean;
  bodyWidth: number;
  widths: PaneWidths;
}

function composeGridColumns({ hideLeft, bodyWidth, widths }: ComposeArgs): string {
  const marginPx = bodyWidth >= 1280 ? `${widths.marginWidth}px` : "0";
  const reviewPx = `${widths.reviewWidth}px`;
  if (hideLeft) return `minmax(0, 1fr) ${marginPx} ${reviewPx}`;
  return `${widths.filesWidth}px minmax(0, 1fr) ${marginPx} ${reviewPx}`;
}

interface DivergenceBannerProps {
  report: { modified: string[]; added: string[]; missing: string[] };
  currentOrdinal: number | undefined;
}

function DivergenceBanner({ report, currentOrdinal }: DivergenceBannerProps): JSX.Element {
  const changes = [...report.modified, ...report.added, ...report.missing];
  const total = changes.length;
  const sample = changes.slice(0, 3).join(", ");
  const more = total > 3 ? ` and ${total - 3} more` : "";
  const label = currentOrdinal !== undefined ? `Draft ${currentOrdinal}` : "the current draft";
  return (
    <p className="project-shell__divergence" role="status">
      You've edited {total} file{total === 1 ? "" : "s"} by hand since {label} ({sample}
      {more}). Applying will capture these changes as a new draft.
    </p>
  );
}
