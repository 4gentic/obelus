import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { splitHeadline } from "../../lib/split-headline";
import ClaudeChip from "./ClaudeChip";
import { useProject } from "./context";
import { usePaperId } from "./OpenPaper";
import { type ReviewRunnerMode, useReviewRunner } from "./review-runner-context";
import { useReviewStore } from "./store-context";
import { useInlineConfirm } from "./use-inline-confirm";
import { descendantsOf, usePaperEdits } from "./use-paper-edits";

const IndicationsSchema = z.string();
const ModeSchema = z.enum(["writer-fast", "rigorous"]);

export default function StartReviewButton(): JSX.Element {
  const { project, repo } = useProject();
  const paperId = usePaperId();
  const store = useReviewStore();
  const annotations = store((s) => s.annotations);
  const { status, start, cancel } = useReviewRunner();

  // Reviewer projects drive Claude from the Review tab (see ReviewerActionsPanel),
  // so this footer only renders for writer projects.
  if (project.kind === "reviewer") return <div className="review-column__actions" />;

  return (
    <WriterStartReview
      paperId={paperId}
      annotationCount={annotations.length}
      statusKind={status.kind}
      statusMessage={status.kind === "done" || status.kind === "error" ? status.message : null}
      onStart={start}
      onCancel={cancel}
      repo={repo}
    />
  );
}

interface WriterStartReviewProps {
  paperId: string | null;
  annotationCount: number;
  statusKind: "idle" | "working" | "running" | "ingesting" | "done" | "error";
  statusMessage: string | null;
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
  annotationCount,
  statusKind,
  statusMessage,
  onStart,
  onCancel,
  repo,
}: WriterStartReviewProps): JSX.Element {
  const edits = usePaperEdits(repo, paperId);
  const confirm = useInlineConfirm();
  const [indications, setIndications] = useState("");
  const [mode, setMode] = useState<ReviewRunnerMode>("writer-fast");

  // Hydrate the textarea + mode selector with the last-used values for this
  // paper so the user's running guidance survives navigation. A change to
  // paperId (user switched variants) reloads independently.
  useEffect(() => {
    let cancelled = false;
    if (!paperId) {
      setIndications("");
      setMode("writer-fast");
      return;
    }
    void (async () => {
      const [persistedIndications, persistedMode] = await Promise.all([
        repo.settings.get(INDICATIONS_KEY(paperId), IndicationsSchema),
        repo.settings.get(MODE_KEY(paperId), ModeSchema),
      ]);
      if (cancelled) return;
      setIndications(persistedIndications ?? "");
      setMode(persistedMode ?? "writer-fast");
    })();
    return () => {
      cancelled = true;
    };
  }, [paperId, repo]);

  const current = edits.live.find((e) => e.id === edits.currentDraftId) ?? edits.head ?? null;
  const isOnTip = !current || current.id === edits.head?.id;
  const discards = current ? descendantsOf(edits.live, current.id) : [];

  useEffect(() => {
    if (statusKind === "done") void edits.refresh();
  }, [statusKind, edits.refresh]);

  const canStart =
    paperId !== null &&
    annotationCount > 0 &&
    statusKind !== "working" &&
    statusKind !== "running" &&
    statusKind !== "ingesting";

  const handleStart = useCallback(async () => {
    if (!canStart || !paperId) return;
    if (!isOnTip && current && discards.length > 0) {
      await repo.paperEdits.tombstoneDescendantsOf(current.id);
      await edits.refresh();
    }
    const trimmed = indications.trim();
    await Promise.all([
      repo.settings.set(INDICATIONS_KEY(paperId), trimmed),
      repo.settings.set(MODE_KEY(paperId), mode),
    ]);
    await onStart({
      paperId,
      mode,
      ...(trimmed !== "" ? { indications: trimmed } : {}),
    });
  }, [
    canStart,
    paperId,
    isOnTip,
    current,
    discards.length,
    repo,
    onStart,
    edits.refresh,
    indications,
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
      {paperId !== null && statusKind !== "running" && (
        <textarea
          className="review-column__indications"
          value={indications}
          onChange={(event) => setIndications(event.target.value)}
          placeholder="Optional notes for this pass — specific directions, constraints, paragraphs to leave alone."
          rows={3}
          disabled={modeDisabled}
        />
      )}
      {paperId !== null && statusKind !== "running" && (
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
          {paperId !== null ? <ClaudeChip /> : null}
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
        <button type="button" className="btn btn--subtle" onClick={() => void onCancel()}>
          Cancel
        </button>
      )}
      {paperId === null && <p className="review-column__hint">Open a paper to start a review.</p>}
      {paperId !== null &&
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
