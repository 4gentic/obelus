import { claudeCancel } from "@obelus/claude-sidecar";
import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { type JobRecord, useJobsStore } from "../lib/jobs-store";
import { emitOpenFile } from "../lib/open-file-event";
import { getRepository } from "../lib/repo";
import { splitHeadline } from "../lib/split-headline";
import { useInlineConfirm } from "../routes/project/use-inline-confirm";
import "./jobs-dock.css";

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
            useJobsStore.getState().dismiss(expanded.claudeSessionId);
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
  return (
    <button
      type="button"
      className={`jobs-dock__seg jobs-dock__seg--${job.status} ${isOpen ? "jobs-dock__seg--open" : ""}`}
      onClick={onToggle}
      aria-expanded={isOpen}
    >
      <span className="jobs-dock__seg-kind">{kindLabel}</span>
      <span className="jobs-dock__seg-title">{title}</span>
      <span className="jobs-dock__seg-phase">{shortPhase(job)}</span>
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
        </dl>
      </header>

      <PhaseLog job={job} />

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

function PhaseLog({ job }: { job: JobRecord }): JSX.Element {
  const entries = job.phaseHistory;
  if (entries.length === 0) {
    return (
      <p className="jobs-dock__panel-empty">
        {isLive(job) ? "Waiting for the first tool call…" : "No phase activity was recorded."}
      </p>
    );
  }
  // Per-row duration is `next.at − cur.at` for terminal rows; for the active
  // row (last entry while the job is live) it is `now − cur.at` and ticks via
  // the dock's existing 1s setInterval. After exit, the active row freezes on
  // its final span (`endedAt − cur.at`).
  const tail = entries.slice(-16);
  const live = isLive(job);
  const referenceEnd = job.endedAt ?? Date.now();
  const lastIndex = entries.length - 1;
  return (
    <ol className="jobs-dock__phases">
      {tail.map((entry, i) => {
        const indexInHistory = entries.length - tail.length + i;
        const isActive = live && indexInHistory === lastIndex;
        const next = entries[indexInHistory + 1];
        const endAt = next ? next.at : referenceEnd;
        const durationMs = Math.max(0, endAt - entry.at);
        return (
          <li
            key={`${entry.at}:${entry.phase}`}
            className={isActive ? "jobs-dock__phase--active" : undefined}
          >
            <time className="jobs-dock__phase-when">{formatHMS(entry.at)}</time>
            <div className="jobs-dock__phase-body">
              <span className="jobs-dock__phase-what">{entry.phase}</span>
              <span className="jobs-dock__phase-dur">
                {isActive ? `running · ${formatElapsed(durationMs)}` : formatElapsed(durationMs)}
              </span>
              {isActive && job.currentTool ? (
                <span className="jobs-dock__phase-now">{job.currentTool}</span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function isLive(job: JobRecord): boolean {
  return job.status === "running" || job.status === "ingesting";
}

function orderJobs(jobs: Record<string, JobRecord>): JobRecord[] {
  return Object.values(jobs).sort((a, b) => a.startedAt - b.startedAt);
}

function shortPhase(job: JobRecord): string {
  switch (job.status) {
    case "running":
      return job.phase || "Working";
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
      return job.phase ? `Running · ${job.phase}` : "Running";
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

function formatHMS(ms: number): string {
  const d = new Date(ms);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
