import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { useJobsStore } from "../../lib/jobs-store";
import { DEFAULT_THOROUGHNESS, type ReviewerThoroughness } from "../../lib/reviewer-thoroughness";
import { splitHeadline } from "../../lib/split-headline";
import { getReviewerThoroughness, setReviewerThoroughness } from "../../store/app-state";
import { useProject } from "./context";
import { useEnsureRevision } from "./ensure-revision-context";
import { useIsPaperOpen, usePaperId } from "./OpenPaper";
import { type ReviewRunnerMode, useReviewRunner } from "./review-runner-context";
import { useReviewStore } from "./store-context";
import ThoroughnessToggle from "./ThoroughnessToggle";
import { useInlineConfirm } from "./use-inline-confirm";
import { descendantsOf, usePaperEdits } from "./use-paper-edits";

const IndicationsSchema = z.string();
const ModeSchema = z.enum(["writer-fast", "rigorous"]);

export default function StartReviewButton(): JSX.Element {
  const { project, repo } = useProject();
  const paperId = usePaperId();
  const isPaperOpen = useIsPaperOpen();
  const ensureRevision = useEnsureRevision();
  const store = useReviewStore();
  const annotations = store((s) => s.annotations);
  const { status, start, cancel } = useReviewRunner();

  // Reviewer projects drive Claude from the Review tab (see ReviewerActionsPanel),
  // so this footer only renders for writer projects.
  if (project.kind === "reviewer") return <div className="review-column__actions" />;

  return (
    <WriterStartReview
      paperId={paperId}
      isPaperOpen={isPaperOpen}
      ensureRevision={ensureRevision}
      annotationCount={annotations.length}
      statusKind={status.kind}
      statusMessage={status.kind === "done" || status.kind === "error" ? status.message : null}
      claudeSessionId={status.kind === "running" ? status.claudeSessionId : null}
      onStart={start}
      onCancel={cancel}
      repo={repo}
    />
  );
}

interface WriterStartReviewProps {
  paperId: string | null;
  isPaperOpen: boolean;
  ensureRevision: (() => Promise<{ paperId: string; revisionId: string }>) | null;
  annotationCount: number;
  statusKind: "idle" | "working" | "running" | "ingesting" | "done" | "error";
  statusMessage: string | null;
  claudeSessionId: string | null;
  onStart: (opts: {
    paperId: string;
    indications?: string;
    mode?: ReviewRunnerMode;
  }) => Promise<void>;
  onCancel: () => Promise<void>;
  repo: import("@obelus/repo").Repository;
}

const INDICATIONS_KEY = (paperId: string): string => `paper.${paperId}.lastIndications`;
const MODE_KEY = (paperId: string): string => `paper.${paperId}.lastWriterMode`;

function WriterStartReview({
  paperId,
  isPaperOpen,
  ensureRevision,
  annotationCount,
  statusKind,
  statusMessage,
  claudeSessionId,
  onStart,
  onCancel,
  repo,
}: WriterStartReviewProps): JSX.Element {
  const edits = usePaperEdits(repo, paperId);
  const confirm = useInlineConfirm();
  const [indications, setIndications] = useState("");
  const [mode, setMode] = useState<ReviewRunnerMode>("writer-fast");
  const [thoroughness, setThoroughnessState] = useState<ReviewerThoroughness>(DEFAULT_THOROUGHNESS);

  // Hydrate the textarea + mode selector with the last-used values for this
  // paper so the user's running guidance survives navigation. A change to
  // paperId (user switched variants) reloads independently. The thoroughness
  // toggle is cross-session (app-state.json), not per-paper, so it loads on
  // mount alongside the per-paper values.
  useEffect(() => {
    let cancelled = false;
    if (!paperId) {
      setIndications("");
      setMode("writer-fast");
      void getReviewerThoroughness().then((stored) => {
        if (!cancelled) setThoroughnessState(stored ?? DEFAULT_THOROUGHNESS);
      });
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      const [persistedIndications, persistedMode, storedThoroughness] = await Promise.all([
        repo.settings.get(INDICATIONS_KEY(paperId), IndicationsSchema),
        repo.settings.get(MODE_KEY(paperId), ModeSchema),
        getReviewerThoroughness(),
      ]);
      if (cancelled) return;
      setIndications(persistedIndications ?? "");
      setMode(persistedMode ?? "writer-fast");
      setThoroughnessState(storedThoroughness ?? DEFAULT_THOROUGHNESS);
    })();
    return () => {
      cancelled = true;
    };
  }, [paperId, repo]);

  const updateThoroughness = useCallback((next: ReviewerThoroughness) => {
    setThoroughnessState(next);
    void setReviewerThoroughness(next);
  }, []);

  const current = edits.live.find((e) => e.id === edits.currentDraftId) ?? edits.head ?? null;
  const isOnTip = !current || current.id === edits.head?.id;
  const discards = current ? descendantsOf(edits.live, current.id) : [];

  useEffect(() => {
    if (statusKind === "done") void edits.refresh();
  }, [statusKind, edits.refresh]);

  const trimmedIndications = indications.trim();
  const canStart =
    isPaperOpen &&
    (annotationCount > 0 || trimmedIndications.length > 0) &&
    statusKind !== "working" &&
    statusKind !== "running" &&
    statusKind !== "ingesting";

  const handleStart = useCallback(async () => {
    if (!canStart) return;
    // Writer-mode MD/HTML papers don't get a paper row until they're needed.
    // Notes-only Start-review on a freshly-opened file is the trigger.
    let effectivePaperId = paperId;
    if (effectivePaperId === null) {
      if (!ensureRevision) return;
      const ensured = await ensureRevision();
      effectivePaperId = ensured.paperId;
    }
    if (!isOnTip && current && discards.length > 0) {
      await repo.paperEdits.tombstoneDescendantsOf(current.id);
      await edits.refresh();
    }
    await Promise.all([
      repo.settings.set(INDICATIONS_KEY(effectivePaperId), trimmedIndications),
      repo.settings.set(MODE_KEY(effectivePaperId), mode),
    ]);
    await onStart({
      paperId: effectivePaperId,
      mode,
      ...(trimmedIndications !== "" ? { indications: trimmedIndications } : {}),
    });
  }, [
    canStart,
    paperId,
    ensureRevision,
    isOnTip,
    current,
    discards.length,
    repo,
    onStart,
    edits.refresh,
    trimmedIndications,
    mode,
  ]);

  const label = (() => {
    if (statusKind === "running") return "Cancel";
    if (!isOnTip && current && discards.length > 0) {
      const suffix = discards.map((d) => d.ordinal).join(", ");
      if (confirm.armed) return `Click to confirm · discards Drafts ${suffix}`;
      return `Review Draft ${current.ordinal} →`;
    }
    return "Start review →";
  })();

  const modeDisabled =
    !canStart && statusKind !== "idle" && statusKind !== "done" && statusKind !== "error";
  const modeName = paperId ? `mode-${paperId}` : "mode";

  return (
    <div className="review-column__actions">
      {isPaperOpen && statusKind !== "running" && (
        <fieldset className="review-column__mode" disabled={modeDisabled}>
          <legend className="visually-hidden">Review thoroughness</legend>
          <label
            className={`review-column__mode-option${mode === "writer-fast" ? " review-column__mode-option--on" : ""}`}
          >
            <input
              type="radio"
              name={modeName}
              value="writer-fast"
              checked={mode === "writer-fast"}
              onChange={() => setMode("writer-fast")}
              className="visually-hidden"
            />
            <span className="review-column__mode-label">Fast</span>
            <span className="review-column__mode-sub">draft now, review in the panel</span>
          </label>
          <label
            className={`review-column__mode-option${mode === "rigorous" ? " review-column__mode-option--on" : ""}`}
          >
            <input
              type="radio"
              name={modeName}
              value="rigorous"
              checked={mode === "rigorous"}
              onChange={() => setMode("rigorous")}
              className="visually-hidden"
            />
            <span className="review-column__mode-label">Rigorous</span>
            <span className="review-column__mode-sub">
              second-pair-of-eyes review of every edit
            </span>
          </label>
        </fieldset>
      )}
      {statusKind !== "running" ? (
        <div className="review-column__launch">
          {isPaperOpen ? (
            <ThoroughnessToggle
              value={thoroughness}
              onChange={updateThoroughness}
              disabled={modeDisabled}
              name={paperId ? `thoroughness-${paperId}` : "thoroughness"}
            />
          ) : null}
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
        </div>
      ) : (
        <>
          {claudeSessionId !== null && <PhaseProgressStrip claudeSessionId={claudeSessionId} />}
          <button type="button" className="btn btn--subtle" onClick={() => void onCancel()}>
            Cancel
          </button>
        </>
      )}
      {isPaperOpen && statusKind !== "running" && (
        <label className="review-column__notes">
          <span className="review-column__notes-label">Notes</span>
          <textarea
            className="review-column__notes-input"
            value={indications}
            onChange={(event) => setIndications(event.target.value)}
            placeholder="Tell the reviewer what to focus on — or leave alone. e.g. “check the whole paper for inconsistencies.”"
            rows={3}
            disabled={modeDisabled}
          />
        </label>
      )}
      {!isPaperOpen && <p className="review-column__hint">Open a paper to start a review.</p>}
      {isPaperOpen &&
        !isOnTip &&
        current &&
        discards.length > 0 &&
        statusKind !== "running" &&
        !confirm.armed && (
          <p className="review-column__hint">
            Starting a new pass will discard Drafts {discards.map((d) => d.ordinal).join(", ")}.
          </p>
        )}
      {(statusKind === "done" || statusKind === "error") && statusMessage !== null && (
        <StatusMessage message={statusMessage} />
      )}
    </div>
  );
}

// WS3 progress strip: minimal "<phase> · MM:SS" line that ticks every second
// while a review run is active. Phase comes from the jobs store (driven by the
// stdout listener); elapsed is computed against the phase's started-at, with a
// fallback to the job's startedAt when no phase has fired yet.
function PhaseProgressStrip({ claudeSessionId }: { claudeSessionId: string }): JSX.Element | null {
  const job = useJobsStore((s) => s.jobs[claudeSessionId]);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!job || (job.status !== "running" && job.status !== "ingesting")) return;
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [job]);

  if (!job) return null;
  const phaseLabel = job.phase || "starting";
  const lastPhase = job.phaseHistory[job.phaseHistory.length - 1];
  const phaseStartedAt = lastPhase?.at ?? job.startedAt;
  const elapsed = Math.max(0, Math.floor((now - phaseStartedAt) / 1_000));
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  return (
    <p className="review-column__hint" aria-live="polite">
      {phaseLabel} · {mm}:{ss}
    </p>
  );
}

function StatusMessage({ message }: { message: string }): JSX.Element {
  const { headline, details } = splitHeadline(message);
  return (
    <>
      <p className="review-column__hint">{headline}</p>
      {details !== null ? (
        <details className="review-column__details">
          <summary>Details</summary>
          <pre>{details}</pre>
        </details>
      ) : null}
    </>
  );
}
