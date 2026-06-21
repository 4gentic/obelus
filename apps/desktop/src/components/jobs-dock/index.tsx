import { claudeCancel } from "@obelus/claude-sidecar";
import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { humanizePhase, isSemanticPhase, SEMANTIC_PHASE_PREFIX } from "../../lib/claude-phase";
import { type JobRecord, STALL_THRESHOLD_MS, useJobsStore } from "../../lib/jobs-store";
import { emitOpenFile } from "../../lib/open-file-event";
import { getRepository } from "../../lib/repo";
import { splitHeadline } from "../../lib/split-headline";
import { useTranscriptStore } from "../../lib/transcript-store";
import { useInlineConfirm } from "../../routes/project/use-inline-confirm";
import "./index.css";
import { JobTranscript } from "./transcript";
import "./transcript.css";

export default function JobsDock(): JSX.Element | null {
  const jobs = useJobsStore((s) => s.jobs);
  const ordered = orderJobs(jobs);
  const hasLive = ordered.some(isLive);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);

  // Elapsed counters tick only while there's something to update.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!hasLive) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [hasLive]);

  // Clicking outside the bar collapses it. Escape also collapses. Safer than
  // blur: the panel contains focusable elements (cancel, open) so blur would
  // fire spuriously when moving focus between them.
  useEffect(() => {
    if (expandedId === null) return;
    const onClick = (ev: MouseEvent): void => {
      const target = ev.target;
      if (!(target instanceof Node)) return;
      if (containerRef.current?.contains(target)) return;
      setExpandedId(null);
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") setExpandedId(null);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [expandedId]);

  // Close the panel when the active job is dismissed out from under it.
  useEffect(() => {
    if (expandedId !== null && !jobs[expandedId]) setExpandedId(null);
  }, [jobs, expandedId]);

  // Reserve room at the bottom of the frame while the dock is visible so the
  // fixed banner never clips scrolling content.
  useEffect(() => {
    if (ordered.length === 0) return;
    document.body.dataset.jobsDock = "1";
    return () => {
      delete document.body.dataset.jobsDock;
    };
  }, [ordered.length]);

  if (ordered.length === 0) return null;

  const expanded = expandedId !== null ? (jobs[expandedId] ?? null) : null;
  const liveCount = ordered.filter(isLive).length;

  return (
    <aside
      ref={containerRef}
      className={expanded ? "jobs-dock jobs-dock--open" : "jobs-dock"}
      aria-label="Background jobs"
    >
      {expanded ? (
        <JobDetailPanel
          job={expanded}
          onClose={() => setExpandedId(null)}
          onDismiss={() => {
            const sid = expanded.claudeSessionId;
            useTranscriptStore.getState().dismiss(sid);
            useJobsStore.getState().dismiss(sid);
          }}
        />
      ) : null}
      <div className="jobs-dock__bar">
        <div className="jobs-dock__lede" aria-hidden="true">
          <span className="jobs-dock__lede-kbd">Background</span>
          <span className="jobs-dock__lede-count">
            {liveCount > 0 ? `${liveCount} running` : `${ordered.length} finished`}
          </span>
        </div>
        <ul className="jobs-dock__segments">
          {ordered.map((job) => (
            <li key={job.claudeSessionId}>
              <JobSegment
                job={job}
                isOpen={expandedId === job.claudeSessionId}
                onToggle={() => {
                  setExpandedId((prev) =>
                    prev === job.claudeSessionId ? null : job.claudeSessionId,
                  );
                }}
              />
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

function jobKindLabel(kind: JobRecord["kind"]): string {
  switch (kind) {
    case "writeup":
      return "Draft";
    case "compile-fix":
      return "Fix compile";
    default:
      return "Review";
  }
}

interface JobSegmentProps {
  job: JobRecord;
  isOpen: boolean;
  onToggle: () => void;
}

function JobSegment({ job, isOpen, onToggle }: JobSegmentProps): JSX.Element {
  const title = job.kind === "writeup" ? (job.paperTitle ?? job.projectLabel) : job.projectLabel;
  const kindLabel = jobKindLabel(job.kind);
  const stalled = isStalled(job, Date.now());
  const segClass = [
    "jobs-dock__seg",
    `jobs-dock__seg--${job.status}`,
    stalled ? "jobs-dock__seg--stalled" : "",
    isOpen ? "jobs-dock__seg--open" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" className={segClass} onClick={onToggle} aria-expanded={isOpen}>
      <span className="jobs-dock__seg-kind">{kindLabel}</span>
      <span className="jobs-dock__seg-title">{title}</span>
      <span className="jobs-dock__seg-phase">{stalled ? "No progress" : shortPhase(job)}</span>
      <span className="jobs-dock__seg-elapsed">
        {formatElapsed((job.endedAt ?? Date.now()) - job.startedAt)}
      </span>
    </button>
  );
}

interface JobDetailPanelProps {
  job: JobRecord;
  onClose: () => void;
  onDismiss: () => void;
}

function JobDetailPanel({ job, onClose, onDismiss }: JobDetailPanelProps): JSX.Element {
  const navigate = useNavigate();
  const live = isLive(job);
  const title = job.kind === "writeup" ? (job.paperTitle ?? job.projectLabel) : job.projectLabel;
  const kindLabel = jobKindLabel(job.kind);
  const cancelConfirm = useInlineConfirm();

  const runCancel = useCallback(async (): Promise<void> => {
    try {
      await claudeCancel(job.claudeSessionId);
    } catch {
      // The Rust side is authoritative; if the process is already gone the
      // exit event will still arrive and mark the job cancelled/errored.
    }
  }, [job.claudeSessionId]);

  const handleCancelClick = useCallback((): void => {
    if (cancelConfirm.armed) {
      void cancelConfirm.confirm(runCancel);
    } else {
      cancelConfirm.arm();
    }
  }, [cancelConfirm, runCancel]);

  const handleOpen = useCallback(async (): Promise<void> => {
    let paperRelPath: string | null = null;
    if (job.paperId) {
      try {
        const repo = await getRepository();
        const paper = await repo.papers.get(job.paperId);
        if (paper?.pdfRelPath) {
          paperRelPath = paper.pdfRelPath;
          await repo.projects.setLastOpenedFile(job.projectId, paper.pdfRelPath);
        }
      } catch {
        // If the repo lookup fails the project still opens on its stored
        // last-opened file — acceptable fallback, better than blocking the nav.
      }
    }
    navigate(`/project/${job.projectId}`);
    // Covers the already-on-this-project case: the route effect only fires on
    // :id change, so a bare navigate leaves `openFilePath` stale.
    if (paperRelPath !== null) {
      emitOpenFile({ projectId: job.projectId, relPath: paperRelPath });
    }
    onClose();
  }, [navigate, job.projectId, job.paperId, onClose]);

  return (
    <section
      className={`jobs-dock__panel jobs-dock__panel--${job.status}`}
      aria-label={`${kindLabel} details`}
    >
      <button
        type="button"
        className="jobs-dock__panel-close"
        onClick={onClose}
        aria-label="Close job details"
      >
        ×
      </button>
      <header className="jobs-dock__panel-head">
        <div>
          <p className="jobs-dock__panel-kind">
            {kindLabel} · {job.projectLabel}
          </p>
          <h3 className="jobs-dock__panel-title">{title}</h3>
        </div>
        <dl className="jobs-dock__panel-meta">
          <div>
            <dt>Status</dt>
            <dd>{statusWord(job)}</dd>
          </div>
          <div>
            <dt>Elapsed</dt>
            <dd>{formatElapsed((job.endedAt ?? Date.now()) - job.startedAt)}</dd>
          </div>
          {job.counts ? (
            <div>
              <dt>Scope</dt>
              <dd>
                {job.counts.marks} {job.counts.marks === 1 ? "mark" : "marks"} · {job.counts.files}{" "}
                {job.counts.files === 1 ? "file" : "files"}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Model</dt>
            <dd className="jobs-dock__panel-model" title={job.model ?? undefined}>
              {job.model ?? <span className="jobs-dock__panel-model--pending">resolving…</span>}
            </dd>
          </div>
        </dl>
      </header>

      {isStalled(job, Date.now()) ? (
        <StallBanner
          job={job}
          onCancel={handleCancelClick}
          cancelArmed={cancelConfirm.armed}
          cancelBind={cancelConfirm.bind()}
        />
      ) : null}

      <JobTranscript job={job} />

      {job.message ? <JobMessage message={job.message} /> : null}

      <footer className="jobs-dock__panel-foot">
        <button type="button" className="jobs-dock__btn" onClick={() => void handleOpen()}>
          {job.paperId ? "Open paper →" : "Open project →"}
        </button>
        {live ? (
          <button
            type="button"
            className="jobs-dock__btn jobs-dock__btn--danger"
            onClick={handleCancelClick}
            {...cancelConfirm.bind()}
          >
            {cancelConfirm.armed ? "Click to confirm" : "Cancel"}
          </button>
        ) : (
          <button type="button" className="jobs-dock__btn" onClick={onDismiss}>
            Dismiss
          </button>
        )}
      </footer>
    </section>
  );
}

interface StallBannerProps {
  job: JobRecord;
  onCancel: () => void;
  cancelArmed: boolean;
  cancelBind: { onBlur: () => void; "data-armed": "true" | "false" };
}

function StallBanner({ job, onCancel, cancelArmed, cancelBind }: StallBannerProps): JSX.Element {
  const idleMs = Date.now() - (job.lastEventAt ?? job.startedAt);
  const idleMin = Math.max(1, Math.floor(idleMs / 60_000));
  const ackKeepWaiting = useCallback((): void => {
    useJobsStore.getState().acknowledgeStall(job.claudeSessionId);
  }, [job.claudeSessionId]);
  return (
    <aside className="jobs-dock__stall" role="alert">
      <p className="jobs-dock__stall-headline">No progress for {idleMin} min.</p>
      <p className="jobs-dock__stall-body">
        The engine CLI may have lost its network connection — common after the laptop sleeps
        mid-run. The subprocess is still alive but no stream events are arriving.
      </p>
      <div className="jobs-dock__stall-actions">
        <button
          type="button"
          className="jobs-dock__btn jobs-dock__btn--danger"
          onClick={onCancel}
          {...cancelBind}
        >
          {cancelArmed ? "Click to confirm" : "Cancel"}
        </button>
        <button type="button" className="jobs-dock__btn" onClick={ackKeepWaiting}>
          Keep waiting
        </button>
      </div>
    </aside>
  );
}

function isLive(job: JobRecord): boolean {
  return job.status === "running" || job.status === "ingesting";
}

// "Stalled" is a visual overlay on a still-running job — the data model
// remains `running`. Suppressed for `STALL_THRESHOLD_MS` after a "Keep waiting"
// click; cleared on any fresh stream event (jobs-store.noteEvent strips
// `stalledAckAt` so the next stall is a new one).
function isStalled(job: JobRecord, now: number): boolean {
  if (job.status !== "running") return false;
  if (job.lastEventAt === undefined) return false;
  if (now - job.lastEventAt <= STALL_THRESHOLD_MS) return false;
  if (job.stalledAckAt !== undefined && now - job.stalledAckAt <= STALL_THRESHOLD_MS) return false;
  return true;
}

function orderJobs(jobs: Record<string, JobRecord>): JobRecord[] {
  return Object.values(jobs).sort((a, b) => a.startedAt - b.startedAt);
}

// `job.phase` is stored raw: a semantic marker arrives as `obelus:<token>`,
// while tool-derived phases are already the human caption from `describePhase`.
// Humanize the semantic form at the display boundary so the dock never shows a
// bare token like `obelus:gather-context`.
function displayPhase(phase: string): string {
  if (isSemanticPhase(phase)) return humanizePhase(phase.slice(SEMANTIC_PHASE_PREFIX.length));
  return phase;
}

function shortPhase(job: JobRecord): string {
  switch (job.status) {
    case "running":
      return job.phase ? displayPhase(job.phase) : "Working";
    case "ingesting":
      return "Ingesting";
    case "done":
      return "Done";
    case "error":
      return "Error";
    case "cancelled":
      return "Cancelled";
  }
}

function JobMessage({ message }: { message: string }): JSX.Element {
  const { headline, details } = splitHeadline(message);
  return (
    <>
      <p className="jobs-dock__panel-message">{headline}</p>
      {details !== null ? (
        <details className="jobs-dock__panel-details">
          <summary>Details</summary>
          <pre>{details}</pre>
        </details>
      ) : null}
    </>
  );
}

function statusWord(job: JobRecord): string {
  switch (job.status) {
    case "running":
      return job.phase ? `Running · ${displayPhase(job.phase)}` : "Running";
    case "ingesting":
      return "Ingesting";
    case "done":
      return "Done";
    case "error":
      return "Error";
    case "cancelled":
      return "Cancelled";
  }
}

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem.toString().padStart(2, "0")}s`;
}
