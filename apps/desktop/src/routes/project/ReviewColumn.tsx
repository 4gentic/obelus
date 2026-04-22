import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import { useProject } from "./context";
import DiffReview from "./DiffReview";
import DraftsPanel from "./DraftsPanel";
import { useDiffStore } from "./diff-store-context";
import { useOpenPaper } from "./OpenPaper";
import ReviewDraft from "./ReviewDraft";
import ReviewerActionsPanel from "./ReviewerActionsPanel";
import ReviewList from "./ReviewList";
import { useReviewRunner } from "./review-runner-context";
import StartReviewButton from "./StartReviewButton";
import { useReviewStore } from "./store-context";
import type { ForkInfo } from "./use-diff-actions";

type WriterView = "marks" | "diff" | "drafts";
type ReviewerView = "marks" | "review";

interface Props {
  onApply: () => void | Promise<void>;
  onRepass: () => void | Promise<void>;
  forkInfo: ForkInfo | null;
  wide: boolean;
  onToggleWide: () => void;
}

interface WriterProps {
  onApply: () => void | Promise<void>;
  onRepass: () => void | Promise<void>;
  forkInfo: ForkInfo | null;
}

export default function ReviewColumn({
  onApply,
  onRepass,
  forkInfo,
  wide,
  onToggleWide,
}: Props): JSX.Element {
  const { project } = useProject();
  return project.kind === "reviewer" ? (
    <ReviewerColumn wide={wide} onToggleWide={onToggleWide} />
  ) : (
    <WriterColumn onApply={onApply} onRepass={onRepass} forkInfo={forkInfo} />
  );
}

function WriterColumn({ onApply, onRepass, forkInfo }: WriterProps): JSX.Element {
  const store = useReviewStore();
  const diffStore = useDiffStore();
  const runner = useReviewRunner();
  const openPaper = useOpenPaper();
  const selected = store((s) => s.selectedAnchor);
  const sessionId = diffStore((s) => s.sessionId);
  const runnerKind = runner.status.kind;
  const [view, setView] = useState<WriterView>("marks");

  useEffect(() => {
    if (
      sessionId !== null ||
      runnerKind === "working" ||
      runnerKind === "running" ||
      runnerKind === "ingesting"
    ) {
      setView("diff");
    }
  }, [sessionId, runnerKind]);

  const paperOpen = openPaper.kind === "ready";
  const runnerBusy =
    runnerKind === "working" || runnerKind === "running" || runnerKind === "ingesting";
  const diffAvailable = sessionId !== null || runnerBusy;
  const resolvedView: WriterView = view === "diff" && !diffAvailable ? "marks" : view;
  const fallbackWhenNoPaper: WriterView = diffAvailable ? "diff" : "marks";
  const effectiveView: WriterView = paperOpen ? resolvedView : fallbackWhenNoPaper;

  return (
    <aside className="review-column">
      <nav className="review-column__tabs">
        {paperOpen && (
          <>
            <button
              type="button"
              className={`review-column__tab${effectiveView === "marks" ? " review-column__tab--on" : ""}`}
              onClick={() => setView("marks")}
            >
              Marks
            </button>
            {diffAvailable && (
              <button
                type="button"
                className={`review-column__tab${effectiveView === "diff" ? " review-column__tab--on" : ""}`}
                onClick={() => setView("diff")}
              >
                Diff
              </button>
            )}
            <button
              type="button"
              className={`review-column__tab${effectiveView === "drafts" ? " review-column__tab--on" : ""}`}
              onClick={() => setView("drafts")}
            >
              Drafts
            </button>
          </>
        )}
      </nav>
      {effectiveView === "marks" ? (
        <>
          <StartReviewButton />
          {selected ? <ReviewDraft /> : <ReviewList />}
        </>
      ) : effectiveView === "drafts" ? (
        <DraftsPanel />
      ) : (
        <DiffReview onApply={onApply} onRepass={onRepass} forkInfo={forkInfo} />
      )}
    </aside>
  );
}

interface ReviewerColumnProps {
  wide: boolean;
  onToggleWide: () => void;
}

function ReviewerColumn({ wide, onToggleWide }: ReviewerColumnProps): JSX.Element {
  const store = useReviewStore();
  const openPaper = useOpenPaper();
  const selected = store((s) => s.selectedAnchor);
  const focusedAnnotationId = store((s) => s.focusedAnnotationId);
  const [view, setView] = useState<ReviewerView>("marks");

  const prevSelectedRef = useRef<typeof selected>(null);
  const prevFocusedRef = useRef<string | null>(null);

  useEffect(() => {
    if (selected && !prevSelectedRef.current) setView("marks");
    prevSelectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    if (focusedAnnotationId && focusedAnnotationId !== prevFocusedRef.current) setView("marks");
    prevFocusedRef.current = focusedAnnotationId;
  }, [focusedAnnotationId]);

  const paperOpen = openPaper.kind === "ready";
  const effectiveView: ReviewerView = paperOpen ? view : "review";

  return (
    <aside className="review-column">
      <nav className="review-column__tabs">
        {paperOpen && (
          <>
            <button
              type="button"
              className={`review-column__tab${effectiveView === "marks" ? " review-column__tab--on" : ""}`}
              onClick={() => setView("marks")}
            >
              Marks
            </button>
            <button
              type="button"
              className={`review-column__tab${effectiveView === "review" ? " review-column__tab--on" : ""}`}
              onClick={() => setView("review")}
            >
              Review
            </button>
          </>
        )}
      </nav>
      {effectiveView === "marks" ? (
        selected ? (
          <ReviewDraft />
        ) : (
          <ReviewList />
        )
      ) : (
        <ReviewerActionsPanel wide={wide} onToggleWide={onToggleWide} />
      )}
    </aside>
  );
}
