import {
  claudeCancel,
  claudeIsAlive,
  claudeSpawn,
  onClaudeExit,
  onClaudeStdout,
  parseStreamLine,
} from "@obelus/claude-sidecar";
import { type JSX, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { fsWriteBytes } from "../../ipc/commands";
import { useJobsStore } from "../../lib/jobs-store";
import { loadClaudeOverrides } from "../../lib/use-claude-defaults";
import { useBuffersStore } from "./buffers-store-context";
import { exportBundleV2ForPaper, exportMdBundleV2ForPaper } from "./build-bundle";
import { buildPriorDraftsPrompt } from "./build-prior-drafts-prompt";
import { useProject } from "./context";
import { usePaperId } from "./OpenPaper";
import { createReviewProgressStore } from "./review-progress-store";
import {
  ReviewRunnerContext,
  type RunCounts,
  type RunOptions,
  type RunStatus,
} from "./review-runner-context";

// Local pre- and post-spawn concerns that don't belong in the global jobs
// store: bundle export progress, pre-flight validation errors. Paper-scoped
// so switching papers mid-start hides the other paper's transient state.
type Local =
  | { kind: "idle" }
  | { kind: "working"; paperId: string; step: string; counts: RunCounts }
  | { kind: "error"; paperId: string | null; message: string };

export function ReviewRunnerProvider({ children }: { children: ReactNode }): JSX.Element {
  const { repo, project, rootId } = useProject();
  const buffers = useBuffersStore();
  const activePaperId = usePaperId();
  const progressStore = useMemo(() => createReviewProgressStore(), []);
  const [local, setLocal] = useState<Local>({ kind: "idle" });

  // The runner mounts once per project but its status must follow the paper
  // currently in focus: switching papers should not carry another paper's
  // running-review UI with it. Filter the jobs store by the active paper.
  const job = useJobsStore((s) => {
    if (!activePaperId) return undefined;
    let active: (typeof s.jobs)[string] | undefined;
    let latest: (typeof s.jobs)[string] | undefined;
    for (const j of Object.values(s.jobs)) {
      if (j.projectId !== project.id || j.kind !== "review") continue;
      if (j.paperId !== activePaperId) continue;
      if (j.status === "running" || j.status === "ingesting") {
        if (!active || j.startedAt > active.startedAt) active = j;
      } else if (!latest || j.startedAt > latest.startedAt) {
        latest = j;
      }
    }
    return active ?? latest;
  });

  const status: RunStatus = useMemo((): RunStatus => {
    if (local.kind === "working" && local.paperId === activePaperId) {
      return { kind: "working", step: local.step, counts: local.counts };
    }
    if (local.kind === "error" && (local.paperId === null || local.paperId === activePaperId)) {
      return { kind: "error", message: local.message };
    }
    if (!job) return { kind: "idle" };
    switch (job.status) {
      case "running":
        if (!job.reviewSessionId) return { kind: "idle" };
        return {
          kind: "running",
          sessionId: job.reviewSessionId,
          claudeSessionId: job.claudeSessionId,
          counts: toCounts(job),
        };
      case "ingesting":
        return { kind: "ingesting", counts: toCounts(job) };
      case "done":
        return { kind: "done", message: job.message ?? "Plan ready." };
      case "error":
        return { kind: "error", message: job.message ?? "Error." };
      case "cancelled":
        return { kind: "done", message: "Review cancelled." };
    }
  }, [local, job, activePaperId]);

  // The detailed in-route panel (tool run counts, char counts, thinking pulse)
  // depends on events we only care about while the user is on the project
  // page. Feed it from a local subscription that filters to the active job's
  // session id.
  useEffect(() => {
    let cancelled = false;
    let unlistenStdout: (() => void) | null = null;

    void onClaudeStdout((ev) => {
      if (cancelled) return;
      const active = findActiveReview(project.id);
      if (!active || active.claudeSessionId !== ev.sessionId) return;
      const parsed = parseStreamLine(ev.line);
      if (parsed) progressStore.getState().ingest(parsed);
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenStdout = fn;
    });

    return () => {
      cancelled = true;
      unlistenStdout?.();
    };
  }, [project.id, progressStore]);

  // Reset the per-review progress store as soon as Claude exits. The diff
  // store is loaded elsewhere — `diff-store-context` subscribes to the jobs
  // store and picks up the session once it transitions to `done`, which
  // happens only after `ingestReview` has written rows to `diff_hunks`.
  // Loading here would race that ingest and leave the diff view empty.
  useEffect(() => {
    let cancelled = false;
    let unlistenExit: (() => void) | null = null;

    void onClaudeExit((ev) => {
      if (cancelled) return;
      const record = useJobsStore.getState().get(ev.sessionId);
      if (!record || record.kind !== "review" || record.projectId !== project.id) return;
      progressStore.getState().reset();
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenExit = fn;
    });

    return () => {
      cancelled = true;
      unlistenExit?.();
    };
  }, [project.id, progressStore]);

  // Reattach to in-flight reviews after a WebView refresh: the Rust process
  // outlives the refresh, so the Claude subprocess (and its stdout/exit
  // stream) keeps running. Without this, the new jobs-listener gets the
  // events but has no job record to update — the apply-revision quietly
  // ingests into a session the UI doesn't show. Run once per active paper.
  useEffect(() => {
    if (!activePaperId) return;
    let cancelled = false;
    void (async () => {
      const sessions = await repo.reviewSessions.listForPaper(activePaperId);
      if (cancelled) return;
      const inFlight = sessions.filter((s) => s.status === "running" || s.status === "ingesting");
      for (const s of inFlight) {
        if (!s.claudeSessionId) continue;
        // Skip if jobs-listener already knows about it (HMR / StrictMode).
        if (useJobsStore.getState().get(s.claudeSessionId)) continue;
        const alive = await claudeIsAlive(s.claudeSessionId).catch(() => false);
        if (cancelled) return;
        const paper = await repo.papers.get(s.paperId);
        if (cancelled) return;
        if (alive) {
          useJobsStore.getState().register({
            claudeSessionId: s.claudeSessionId,
            projectId: s.projectId,
            projectLabel: project.label,
            rootId,
            kind: "review",
            startedAt: new Date(s.startedAt).getTime(),
            reviewSessionId: s.id,
            paperId: s.paperId,
            ...(paper?.title ? { paperTitle: paper.title } : {}),
          });
          if (s.status === "ingesting") {
            useJobsStore.getState().markIngesting(s.claudeSessionId);
          }
          console.info("[review-session]", {
            sessionId: s.id,
            paperId: s.paperId,
            status: "reattached",
            dbStatus: s.status,
          });
        } else {
          const msg = "Previous review run did not complete (app was closed mid-flight).";
          await repo.reviewSessions.setStatus(s.id, "failed", msg);
          console.info("[review-session]", {
            sessionId: s.id,
            paperId: s.paperId,
            status: "failed",
            lastError: msg,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo, project.label, rootId, activePaperId]);

  const start = useCallback(
    async (opts?: RunOptions): Promise<void> => {
      if (!opts?.paperId) {
        setLocal({
          kind: "error",
          paperId: null,
          message: "Open a paper before starting a review.",
        });
        return;
      }
      const paperId = opts.paperId;
      if (findActiveReviewForPaper(paperId)) return;

      const dirty = buffers.getState().dirtyPaths();
      if (dirty.length > 0) {
        const first = dirty[0] ?? "";
        setLocal({
          kind: "error",
          paperId,
          message:
            dirty.length === 1
              ? `Save or discard unsaved edits in ${first} first.`
              : `Save or discard unsaved edits in ${dirty.length} files first.`,
        });
        return;
      }

      const startedAt = Date.now();
      progressStore.getState().start();
      setLocal({
        kind: "working",
        paperId,
        step: "Exporting bundle…",
        counts: { marks: 0, files: 0, startedAt },
      });
      let createdSessionId: string | null = null;
      try {
        const paper = await repo.papers.get(paperId);
        if (!paper) throw new Error(`paper ${paperId} not found`);
        const { filename, json, annotationCount, fileCount } =
          paper.format === "md"
            ? await exportMdBundleV2ForPaper({ repo, paperId })
            : await exportBundleV2ForPaper({ repo, paperId, rootId });
        const counts: RunCounts = { marks: annotationCount, files: fileCount, startedAt };
        const bytes = new TextEncoder().encode(json);
        await fsWriteBytes(rootId, filename, bytes);

        const overrides = await loadClaudeOverrides();

        const session = await repo.reviewSessions.create({
          projectId: project.id,
          paperId,
          bundleId: filename,
          model: overrides.model,
          effort: overrides.effort,
        });
        createdSessionId = session.id;
        console.info("[review-session]", {
          sessionId: session.id,
          paperId,
          format: paper.format,
          status: "running",
          bundleId: filename,
        });

        setLocal({ kind: "working", paperId, step: "Spawning Claude…", counts });
        const priorContext = await buildPriorDraftsPrompt(repo, paperId);
        const indicationsBlock =
          opts.indications && opts.indications.trim().length > 0
            ? `\n## Indications for this pass\n\n${opts.indications.trim()}\n`
            : "";
        const combinedExtra = [priorContext, indicationsBlock, opts.extraPromptBody ?? ""]
          .filter((s) => s.trim().length > 0)
          .join("\n");
        const claudeSessionId = await claudeSpawn({
          rootId,
          bundleRelPath: filename,
          ...(combinedExtra !== "" ? { extraPromptBody: combinedExtra } : {}),
          model: overrides.model,
          effort: overrides.effort,
        });
        await repo.reviewSessions.setClaudeSessionId(session.id, claudeSessionId);

        useJobsStore.getState().register({
          claudeSessionId,
          projectId: project.id,
          projectLabel: project.label,
          rootId,
          kind: "review",
          startedAt,
          counts: { marks: counts.marks, files: counts.files },
          reviewSessionId: session.id,
          paperId,
          ...(paper?.title ? { paperTitle: paper.title } : {}),
        });
        setLocal({ kind: "idle" });
      } catch (err) {
        progressStore.getState().reset();
        const detail =
          err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err);
        const message = `Could not start review: ${detail}`;
        console.warn("[review-start]", { paperId, sessionId: createdSessionId, detail });
        if (createdSessionId !== null) {
          await repo.reviewSessions.setStatus(createdSessionId, "failed", message);
          console.info("[review-session]", {
            sessionId: createdSessionId,
            paperId,
            status: "failed",
            lastError: message,
          });
        }
        setLocal({ kind: "error", paperId, message });
      }
    },
    [repo, project.id, project.label, rootId, buffers, progressStore],
  );

  const cancel = useCallback(async (): Promise<void> => {
    if (!activePaperId) return;
    const active = findActiveReviewForPaper(activePaperId);
    if (!active) return;
    await claudeCancel(active.claudeSessionId);
  }, [activePaperId]);

  return (
    <ReviewRunnerContext.Provider value={{ status, start, cancel, progressStore }}>
      {children}
    </ReviewRunnerContext.Provider>
  );
}

function findActiveReview(projectId: string) {
  const jobs = useJobsStore.getState().jobs;
  for (const j of Object.values(jobs)) {
    if (j.projectId !== projectId) continue;
    if (j.kind !== "review") continue;
    if (j.status === "running" || j.status === "ingesting") return j;
  }
  return undefined;
}

function findActiveReviewForPaper(paperId: string) {
  const jobs = useJobsStore.getState().jobs;
  for (const j of Object.values(jobs)) {
    if (j.paperId !== paperId) continue;
    if (j.kind !== "review") continue;
    if (j.status === "running" || j.status === "ingesting") return j;
  }
  return undefined;
}

function toCounts(job: {
  startedAt: number;
  counts?: { marks: number; files: number };
}): RunCounts {
  return {
    marks: job.counts?.marks ?? 0,
    files: job.counts?.files ?? 0,
    startedAt: job.startedAt,
  };
}
