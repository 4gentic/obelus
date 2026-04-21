import type { JSX } from "react";
import { useProject } from "./context";
import { useReviewRunner } from "./review-runner-context";
import { useReviewStore } from "./store-context";
export default function StartReviewButton(): JSX.Element {
  const { project } = useProject();
  const store = useReviewStore();
  const annotations = store((s) => s.annotations);
  const { status, start, cancel } = useReviewRunner();

  // Reviewer projects drive Claude from the Review tab (see ReviewerActionsPanel),
  // so this footer only renders for writer projects.
  if (project.kind === "reviewer") return <div className="review-column__footer" />;

  const canStart =
    annotations.length > 0 &&
    status.kind !== "working" &&
    status.kind !== "running" &&
    status.kind !== "ingesting";

  return (
    <div className="review-column__footer">
      {status.kind !== "running" ? (
        <button
          type="button"
          className="btn btn--primary"
          disabled={!canStart}
          onClick={() => void start()}
        >
          Start review →
        </button>
      ) : (
        <button type="button" className="btn btn--subtle" onClick={() => void cancel()}>
          Cancel
        </button>
      )}
      {status.kind === "done" && <p className="review-column__hint">{status.message}</p>}
      {status.kind === "error" && <p className="review-column__hint">{status.message}</p>}
    </div>
  );
}
