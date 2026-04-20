import type { JSX } from "react";
import { useEffect, useState } from "react";
import { useProject } from "./context";
import DiffReview from "./DiffReview";
import { useDiffStore } from "./diff-store-context";
import { useOpenPaper } from "./OpenPaper";
import ReviewDraft from "./ReviewDraft";
import ReviewList from "./ReviewList";
import { useReviewRunner } from "./review-runner-context";
import StartReviewButton from "./StartReviewButton";
import { useReviewStore } from "./store-context";
import WriteUpPanel from "./WriteUpPanel";

type View = "marks" | "diff" | "writeup";

interface Props {
  onApply: () => void | Promise<void>;
  onRepass: () => void | Promise<void>;
}

export default function ReviewColumn({ onApply, onRepass }: Props): JSX.Element {
  const { project } = useProject();
  const store = useReviewStore();
  const diffStore = useDiffStore();
  const runner = useReviewRunner();
  const openPaper = useOpenPaper();
  const selected = store((s) => s.selectedAnchor);
  const sessionId = diffStore((s) => s.sessionId);
  const runnerKind = runner.status.kind;
  const reviewerMode = project.kind !== "folder";
  const [view, setView] = useState<View>("marks");

  useEffect(() => {
    if (reviewerMode) return;
    if (
      sessionId !== null ||
      runnerKind === "working" ||
      runnerKind === "running" ||
      runnerKind === "ingesting"
    ) {
      setView("diff");
    }
  }, [sessionId, runnerKind, reviewerMode]);

  const paperOpen = openPaper.kind === "ready";
  const secondaryTab: View = reviewerMode ? "writeup" : "diff";
  const runnerBusy =
    runnerKind === "working" || runnerKind === "running" || runnerKind === "ingesting";
  const secondaryAvailable = reviewerMode || sessionId !== null || runnerBusy;
  const resolvedView: View = view === secondaryTab && !secondaryAvailable ? "marks" : view;
  const fallbackWhenNoPaper: View = secondaryAvailable ? secondaryTab : "marks";
  const effectiveView: View = paperOpen ? resolvedView : fallbackWhenNoPaper;

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
            {secondaryAvailable && (
              <button
                type="button"
                className={`review-column__tab${effectiveView === secondaryTab ? " review-column__tab--on" : ""}`}
                onClick={() => setView(secondaryTab)}
              >
                {reviewerMode ? "Write-up" : "Diff"}
              </button>
            )}
          </>
        )}
      </nav>
      {effectiveView === "marks" ? (
        <>
          {selected ? <ReviewDraft /> : <ReviewList />}
          <StartReviewButton />
        </>
      ) : effectiveView === "diff" ? (
        <DiffReview onApply={onApply} onRepass={onRepass} />
      ) : (
        <WriteUpPanel />
      )}
    </aside>
  );
}
