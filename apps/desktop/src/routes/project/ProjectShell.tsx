import type { JSX } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import CenterPane from "./CenterPane";
import { useProject } from "./context";
import FilesColumn from "./FilesColumn";
import MarginGutter from "./MarginGutter";
import { useOpenPaper } from "./OpenPaper";
import ReviewColumn from "./ReviewColumn";
import { useReviewStore } from "./store-context";
import { useDiffActions } from "./use-diff-actions";
import { useWorkingTreeDivergence } from "./use-divergence";
import { useLoadRevision } from "./use-load-revision";
import { usePaperEdits } from "./use-paper-edits";

export default function ProjectShell(): JSX.Element {
  const { project, repo, rootId } = useProject();
  const openPaper = useOpenPaper();
  useLoadRevision();
  const { apply, repass, forkInfo } = useDiffActions();
  const reviewStore = useReviewStore();
  const edits = usePaperEdits(repo, project.id);
  const currentDraft = useMemo(
    () => edits.live.find((e) => e.id === edits.currentDraftId),
    [edits.live, edits.currentDraftId],
  );
  const divergence = useWorkingTreeDivergence(rootId, currentDraft);
  const [reviewWide, setReviewWide] = useState(false);
  const onToggleReviewWide = useCallback(() => setReviewWide((w) => !w), []);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key !== "Escape") return;
      const target = ev.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (target.isContentEditable) return;
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
  }, [reviewStore]);

  const hideLeft = project.kind === "reviewer";
  const classes = ["project-shell__body"];
  if (openPaper.kind === "none") classes.push("project-shell__body--no-pdf");
  if (hideLeft) classes.push("project-shell__body--no-left");
  if (reviewWide) classes.push("project-shell__body--review-wide");
  const bodyClass = classes.join(" ");

  return (
    <div className="project-shell">
      <header className="project-shell__header">
        <h1 className="project-shell__title">{project.label}</h1>
        <code className="project-shell__root">{project.root}</code>
      </header>
      {divergence.dirty && divergence.report !== null && (
        <DivergenceBanner report={divergence.report} currentOrdinal={divergence.currentOrdinal} />
      )}
      <div className={bodyClass}>
        {project.kind === "writer" ? <FilesColumn /> : null}
        <main className="project-shell__center">
          <CenterPane />
        </main>
        <div className="project-shell__margin">
          <MarginGutter />
        </div>
        <div className="project-shell__review">
          <ReviewColumn
            onApply={apply}
            onRepass={repass}
            forkInfo={forkInfo}
            wide={reviewWide}
            onToggleWide={onToggleReviewWide}
          />
        </div>
      </div>
    </div>
  );
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
