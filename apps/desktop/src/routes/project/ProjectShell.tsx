import type { JSX } from "react";
import { useEffect } from "react";
import CenterPane from "./CenterPane";
import { useProject } from "./context";
import FilesColumn from "./FilesColumn";
import MarginGutter from "./MarginGutter";
import { useOpenPaper } from "./OpenPaper";
import ReviewColumn from "./ReviewColumn";
import { useReviewStore } from "./store-context";
import { useDiffActions } from "./use-diff-actions";
import { useLoadRevision } from "./use-load-revision";
export default function ProjectShell(): JSX.Element {
  const { project } = useProject();
  const openPaper = useOpenPaper();
  useLoadRevision();
  const { apply, repass } = useDiffActions();
  const reviewStore = useReviewStore();

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
  const bodyClass =
    (openPaper.kind === "none"
      ? "project-shell__body project-shell__body--no-pdf"
      : "project-shell__body") + (hideLeft ? " project-shell__body--no-left" : "");

  return (
    <div className="project-shell">
      <header className="project-shell__header">
        <h1 className="project-shell__title">{project.label}</h1>
        <code className="project-shell__root">{project.root}</code>
      </header>
      <div className={bodyClass}>
        {project.kind === "writer" ? <FilesColumn /> : null}
        <main className="project-shell__center">
          <CenterPane />
        </main>
        <div className="project-shell__margin">
          <MarginGutter />
        </div>
        <div className="project-shell__review">
          <ReviewColumn onApply={apply} onRepass={repass} />
        </div>
      </div>
    </div>
  );
}
