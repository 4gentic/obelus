import type { JSX } from "react";
import { useCallback, useEffect } from "react";
import { useProject } from "./context";
import { useReviewRunner } from "./review-runner-context";
import { useReviewStore } from "./store-context";
import { useInlineConfirm } from "./use-inline-confirm";
import { descendantsOf, usePaperEdits } from "./use-paper-edits";

export default function StartReviewButton(): JSX.Element {
  const { project, repo } = useProject();
  const store = useReviewStore();
  const annotations = store((s) => s.annotations);
  const { status, start, cancel } = useReviewRunner();

  // Reviewer projects drive Claude from the Review tab (see ReviewerActionsPanel),
  // so this footer only renders for writer projects.
  if (project.kind === "reviewer") return <div className="review-column__actions" />;

  return (
    <WriterStartReview
      annotationCount={annotations.length}
      statusKind={status.kind}
      statusMessage={status.kind === "done" || status.kind === "error" ? status.message : null}
      onStart={start}
      onCancel={cancel}
      repo={repo}
      projectId={project.id}
    />
  );
}

interface WriterStartReviewProps {
  annotationCount: number;
  statusKind: "idle" | "working" | "running" | "ingesting" | "done" | "error";
  statusMessage: string | null;
  onStart: () => Promise<void>;
  onCancel: () => Promise<void>;
  repo: import("@obelus/repo").Repository;
  projectId: string;
}

function WriterStartReview({
  annotationCount,
  statusKind,
  statusMessage,
  onStart,
  onCancel,
  repo,
  projectId,
}: WriterStartReviewProps): JSX.Element {
  const edits = usePaperEdits(repo, projectId);
  const confirm = useInlineConfirm();

  const current = edits.live.find((e) => e.id === edits.currentDraftId) ?? edits.head ?? null;
  const isOnTip = !current || current.id === edits.head?.id;
  const discards = current ? descendantsOf(edits.live, current.id) : [];

  // After a successful pass, head may shift. Re-read to keep the warning line
  // current.
  useEffect(() => {
    if (statusKind === "done") void edits.refresh();
  }, [statusKind, edits.refresh]);

  const canStart =
    annotationCount > 0 &&
    statusKind !== "working" &&
    statusKind !== "running" &&
    statusKind !== "ingesting";

  const handleStart = useCallback(async () => {
    if (!canStart) return;
    if (!isOnTip && current && discards.length > 0) {
      // Non-tip: drop descendants before starting the new pass. User has
      // confirmed via the inline two-click pattern.
      await repo.paperEdits.tombstoneDescendantsOf(current.id);
      await edits.refresh();
    }
    await onStart();
  }, [canStart, isOnTip, current, discards.length, repo, onStart, edits.refresh]);

  const label = (() => {
    if (statusKind === "running") return "Cancel";
    if (!isOnTip && current && discards.length > 0) {
      const suffix = discards.map((d) => d.ordinal).join(", ");
      if (confirm.armed) return `Click to confirm · discards Drafts ${suffix}`;
      return `Review Draft ${current.ordinal} →`;
    }
    return "Start review →";
  })();

  return (
    <div className="review-column__actions">
      {statusKind !== "running" ? (
        <button
          type="button"
          className={
            confirm.armed ? "btn btn--primary review-column__start--danger" : "btn btn--primary"
          }
          disabled={!canStart}
          onClick={() => {
            if (!isOnTip && discards.length > 0 && !confirm.armed) {
              confirm.arm();
              return;
            }
            void confirm.confirm(() => handleStart());
          }}
          {...confirm.bind()}
        >
          {label}
        </button>
      ) : (
        <button type="button" className="btn btn--subtle" onClick={() => void onCancel()}>
          Cancel
        </button>
      )}
      {!isOnTip && current && discards.length > 0 && statusKind !== "running" && !confirm.armed && (
        <p className="review-column__hint">
          Starting a new pass will discard Drafts {discards.map((d) => d.ordinal).join(", ")}.
        </p>
      )}
      {statusKind === "done" && statusMessage !== null && (
        <p className="review-column__hint">{statusMessage}</p>
      )}
      {statusKind === "error" && statusMessage !== null && (
        <p className="review-column__hint">{statusMessage}</p>
      )}
    </div>
  );
}
