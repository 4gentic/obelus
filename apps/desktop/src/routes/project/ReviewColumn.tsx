import type { JSX } from "react";
import { type ComponentType, lazy, Suspense, useEffect, useRef, useState } from "react";
import { fsWriteBytes } from "../../ipc/commands";
import { exportMdBundleV2ForPaper } from "./build-bundle";
import { useProject } from "./context";
import DiffReview from "./DiffReview";
import { useDiffStore } from "./diff-store-context";
import { useOpenPaper } from "./OpenPaper";
import ReviewDraft from "./ReviewDraft";
import ReviewerActionsPanel from "./ReviewerActionsPanel";
import ReviewList from "./ReviewList";
import { useReviewRunner } from "./review-runner-context";
import StartReviewButton from "./StartReviewButton";
import { useReviewStore } from "./store-context";
import type { ForkInfo } from "./use-diff-actions";

// Drafter mode is in preview behind a build-time flag — see
// `docs/drafter-design.md` and `DrafterTab.tsx`. The flag must gate the
// import path itself, not just the JSX, so production builds can fully
// dead-code-eliminate the drafter module. `import.meta.env.VITE_DRAFTER_PREVIEW`
// is a Vite build-time replacement: when unset, the conditional below resolves
// to `null` at compile time and the dynamic `import()` is never emitted.
const DrafterTab: ComponentType | null =
  import.meta.env.VITE_DRAFTER_PREVIEW === "1" ? lazy(() => import("./DrafterTab")) : null;

type WriterView = "marks" | "diff" | "drafter";
type ReviewerView = "marks" | "review" | "drafter";

interface Props {
  onApply: () => void | Promise<void>;
  onRepass: () => void | Promise<void>;
  onDiscard: () => void | Promise<void>;
  forkInfo: ForkInfo | null;
}

interface WriterProps {
  onApply: () => void | Promise<void>;
  onRepass: () => void | Promise<void>;
  onDiscard: () => void | Promise<void>;
  forkInfo: ForkInfo | null;
}

const BUSY_TAB_TITLE = "Review in progress — switch back when it finishes.";

export default function ReviewColumn({
  onApply,
  onRepass,
  onDiscard,
  forkInfo,
}: Props): JSX.Element {
  const { project } = useProject();
  return project.kind === "reviewer" ? (
    <ReviewerColumn />
  ) : (
    <WriterColumn onApply={onApply} onRepass={onRepass} onDiscard={onDiscard} forkInfo={forkInfo} />
  );
}

function WriterColumn({ onApply, onRepass, onDiscard, forkInfo }: WriterProps): JSX.Element {
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

  const paperOpen = openPaper.kind === "ready" || openPaper.kind === "ready-md";
  const runnerBusy =
    runnerKind === "working" || runnerKind === "running" || runnerKind === "ingesting";
  const diffAvailable = sessionId !== null || runnerBusy;
  const resolvedView: WriterView = view === "diff" && !diffAvailable ? "marks" : view;
  const fallbackWhenNoPaper: WriterView = diffAvailable ? "diff" : "marks";
  const effectiveView: WriterView = paperOpen ? resolvedView : fallbackWhenNoPaper;
  const lockNonDiffTabs = runnerBusy;

  return (
    <aside className="review-column">
      <nav className="review-column__tabs">
        {paperOpen && (
          <>
            <button
              type="button"
              className={`review-column__tab${effectiveView === "marks" ? " review-column__tab--on" : ""}`}
              onClick={() => setView("marks")}
              disabled={lockNonDiffTabs}
              title={lockNonDiffTabs ? BUSY_TAB_TITLE : undefined}
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
            {DrafterTab !== null && (
              <button
                type="button"
                className={`review-column__tab${effectiveView === "drafter" ? " review-column__tab--on" : ""}`}
                onClick={() => setView("drafter")}
                disabled={lockNonDiffTabs}
                title={lockNonDiffTabs ? BUSY_TAB_TITLE : undefined}
              >
                Draft
              </button>
            )}
          </>
        )}
      </nav>
      {effectiveView === "marks" ? (
        <>
          <StartReviewButton />
          <MdExportChip />
          {selected ? <ReviewDraft /> : <ReviewList />}
        </>
      ) : effectiveView === "drafter" && DrafterTab !== null ? (
        <Suspense fallback={null}>
          <DrafterTab />
        </Suspense>
      ) : (
        <DiffReview
          onApply={onApply}
          onRepass={onRepass}
          onDiscard={onDiscard}
          forkInfo={forkInfo}
        />
      )}
    </aside>
  );
}

function ReviewerColumn(): JSX.Element {
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

  const paperOpen = openPaper.kind === "ready" || openPaper.kind === "ready-md";
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
            {DrafterTab !== null && (
              <button
                type="button"
                className={`review-column__tab${effectiveView === "drafter" ? " review-column__tab--on" : ""}`}
                onClick={() => setView("drafter")}
              >
                Draft
              </button>
            )}
          </>
        )}
      </nav>
      {effectiveView === "marks" ? (
        selected ? (
          <ReviewDraft />
        ) : (
          <ReviewList />
        )
      ) : effectiveView === "drafter" && DrafterTab !== null ? (
        <Suspense fallback={null}>
          <DrafterTab />
        </Suspense>
      ) : (
        <ReviewerActionsPanel />
      )}
    </aside>
  );
}

// Writer-mode Export bundle affordance for MD papers. PDF writer projects
// export through the Diff/Drafts flow; MD doesn't yet have that plumbing, so
// an explicit bundle export is the hand-off to `/apply-revision`.
function MdExportChip(): JSX.Element | null {
  const openPaper = useOpenPaper();
  const { repo, rootId } = useProject();
  const store = useReviewStore();
  const annotations = store((s) => s.annotations);
  const [status, setStatus] = useState<
    { kind: "idle" } | { kind: "saved"; relPath: string } | { kind: "error"; message: string }
  >({ kind: "idle" });

  const mdPaper = openPaper.kind === "ready-md" ? openPaper.paper : null;
  if (!mdPaper) return null;

  async function onExport(): Promise<void> {
    if (!mdPaper) return;
    setStatus({ kind: "idle" });
    try {
      const { filename, json } = await exportMdBundleV2ForPaper({ repo, paperId: mdPaper.id });
      const bytes = new TextEncoder().encode(json);
      await fsWriteBytes(rootId, filename, bytes);
      setStatus({ kind: "saved", relPath: filename });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not export bundle.",
      });
    }
  }

  return (
    <div className="review-column__md-export">
      <button
        type="button"
        className="btn btn--subtle"
        onClick={() => void onExport()}
        disabled={annotations.length === 0}
      >
        Export bundle ({annotations.length})
      </button>
      {status.kind === "saved" ? (
        <p className="review-column__hint">Saved to {status.relPath}</p>
      ) : status.kind === "error" ? (
        <p className="review-column__hint" role="alert">
          {status.message}
        </p>
      ) : null}
    </div>
  );
}
