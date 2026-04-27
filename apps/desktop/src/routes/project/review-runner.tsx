import {
  claudeCancel,
  claudeIsAlive,
  claudeSpawn,
  onClaudeExit,
  onClaudeStdout,
  parseStreamLine,
} from "@obelus/claude-sidecar";
import { type JSX, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { workspaceWriteText } from "../../ipc/commands";
import {
  type BundleLike,
  collectBundleSourcePaths,
  snapshotBundleSources,
  stashSnapshotForSession,
} from "../../lib/bundle-sources";
import { useJobsStore } from "../../lib/jobs-store";
import { appendMetric, nowIso } from "../../lib/metrics";
import { DEFAULT_THOROUGHNESS, THOROUGHNESS_SPAWN } from "../../lib/reviewer-thoroughness";
import { getReviewerThoroughness } from "../../store/app-state";
import { useBuffersStore } from "./buffers-store-context";
import {
  exportBundleForPaper,
  exportHtmlBundleForPaper,
  exportMdBundleForPaper,
} from "./build-bundle";
import { buildPriorDraftsPrompt } from "./build-prior-drafts-prompt";
import { useProject } from "./context";
import { usePaperId } from "./OpenPaper";
import { createReviewProgressStore } from "./review-progress-store";
import {
  type DeepReviewOptions,
  ReviewRunnerContext,
  type ReviewRunnerMode,
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
        const tBundleStart = performance.now();
        const paper = await repo.papers.get(paperId);
        if (!paper) throw new Error(`paper ${paperId} not found`);
        const { filename, json, annotationCount, fileCount, anchorResolution } =
          paper.format === "md"
            ? await exportMdBundleForPaper({ repo, paperId })
            : paper.format === "html"
              ? await exportHtmlBundleForPaper({ repo, paperId })
              : await exportBundleForPaper({ repo, paperId, rootId });
        const counts: RunCounts = { marks: annotationCount, files: fileCount, startedAt };
        const bytes = new TextEncoder().encode(json);
        console.info("[write-perf]", {
          step: "bundle-build",
          ms: Math.round(performance.now() - tBundleStart),
          annotationCount,
          fileCount,
          bytes: bytes.byteLength,
          format: paper.format,
        });

        const tBundleFlush = performance.now();
        await workspaceWriteText(project.id, filename, json);
        console.info("[write-perf]", {
          step: "bundle-flush",
          ms: Math.round(performance.now() - tBundleFlush),
          bytes: bytes.byteLength,
        });

        const thoroughness = (await getReviewerThoroughness()) ?? DEFAULT_THOROUGHNESS;
        const spawn = THOROUGHNESS_SPAWN[thoroughness];
        const effectiveModel: string = spawn.model;
        const effectiveEffort: string = spawn.effort;

        const session = await repo.reviewSessions.create({
          projectId: project.id,
          paperId,
          bundleId: filename,
          model: effectiveModel,
          effort: effectiveEffort,
        });
        createdSessionId = session.id;
        // Snapshot the paper's source files now, so on exit we can tell
        // whether Claude bypassed plan-fix and mutated source directly. If
        // any of these files' sha256 changes and no plan file is produced,
        // the jobs-listener surfaces a tool-policy-violation error.
        try {
          const bundleShape = JSON.parse(json) as BundleLike;
          const paths = collectBundleSourcePaths(bundleShape);
          const snap = await snapshotBundleSources(rootId, paths);
          stashSnapshotForSession(session.id, snap);
        } catch (err) {
          console.warn("[source-snapshot]", {
            sessionId: session.id,
            outcome: "pre-spawn-snapshot-failed",
            detail: err instanceof Error ? err.message : String(err),
          });
        }
        console.info("[review-session]", {
          sessionId: session.id,
          paperId,
          format: paper.format,
          status: "running",
          bundleId: filename,
        });

        setLocal({ kind: "working", paperId, step: "Spawning Claude…", counts });
        const tPriorContext = performance.now();
        const priorContext = await buildPriorDraftsPrompt(repo, paperId);
        console.info("[write-perf]", {
          step: "prior-context",
          ms: Math.round(performance.now() - tPriorContext),
        });
        const indicationsBlock =
          opts.indications && opts.indications.trim().length > 0
            ? `\n## Indications for this pass\n\n${opts.indications.trim()}\n`
            : "";
        const combinedExtra = [priorContext, indicationsBlock, opts.extraPromptBody ?? ""]
          .filter((s) => s.trim().length > 0)
          .join("\n");
        const mode: ReviewRunnerMode =
          opts.mode ?? (project.kind === "writer" ? "writer-fast" : "rigorous");
        // Boundary log: what the React side is actually handing to the spawn.
        // Pairs with `[claude-session] spawn-model …` in stderr to pin down
        // which hop drops the value when the toggle's selection doesn't reach
        // the CLI argv.
        console.info("[spawn-model]", {
          reviewSessionId: session.id,
          thoroughness,
          effectiveModel,
          effectiveEffort,
          mode,
        });
        const tSpawn = performance.now();
        const claudeSessionId = await claudeSpawn({
          rootId,
          projectId: project.id,
          bundleWorkspaceRelPath: filename,
          ...(combinedExtra !== "" ? { extraPromptBody: combinedExtra } : {}),
          model: effectiveModel,
          effort: effectiveEffort,
          mode,
        });
        console.info("[write-perf]", {
          step: "spawn",
          ms: Math.round(performance.now() - tSpawn),
          sessionId: claudeSessionId,
          mode,
          clickToSpawnMs: Date.now() - startedAt,
        });
        await repo.reviewSessions.setClaudeSessionId(session.id, claudeSessionId);
        await appendMetric(project.id, claudeSessionId, {
          event: "anchor-resolution",
          at: nowIso(),
          sessionId: claudeSessionId,
          source: anchorResolution.source,
          pdfFallback: anchorResolution.pdfFallback,
          htmlFallback: anchorResolution.htmlFallback,
        });

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
    [repo, project.id, project.label, project.kind, rootId, buffers, progressStore],
  );

  const cancel = useCallback(async (): Promise<void> => {
    if (!activePaperId) return;
    const active = findActiveReviewForPaper(activePaperId);
    if (!active) return;
    await claudeCancel(active.claudeSessionId);
  }, [activePaperId]);

  const startDeepReview = useCallback(
    async (opts: DeepReviewOptions): Promise<void> => {
      const startedAt = Date.now();
      try {
        const session = await repo.reviewSessions.get(opts.reviewSessionId);
        if (!session) throw new Error(`review session ${opts.reviewSessionId} not found`);
        const paper = await repo.papers.get(opts.paperId);

        const thoroughness = (await getReviewerThoroughness()) ?? DEFAULT_THOROUGHNESS;
        const spawn = THOROUGHNESS_SPAWN[thoroughness];
        const effectiveModel: string = spawn.model;
        const effectiveEffort: string = spawn.effort;

        const claudeSessionId = await claudeSpawn({
          rootId,
          projectId: project.id,
          bundleWorkspaceRelPath: opts.planWorkspaceRelPath,
          model: effectiveModel,
          effort: effectiveEffort,
          mode: "deep-review",
        });
        await repo.reviewSessions.setClaudeSessionId(opts.reviewSessionId, claudeSessionId);

        useJobsStore.getState().register({
          claudeSessionId,
          projectId: project.id,
          projectLabel: project.label,
          rootId,
          kind: "review",
          startedAt,
          reviewSessionId: opts.reviewSessionId,
          paperId: opts.paperId,
          ...(paper?.title ? { paperTitle: paper.title } : {}),
        });
        console.info("[deep-review-spawn]", {
          reviewSessionId: opts.reviewSessionId,
          claudeSessionId,
          planPath: opts.planWorkspaceRelPath,
          thoroughness,
          model: effectiveModel,
          effort: effectiveEffort,
        });
      } catch (err) {
        const detail =
          err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err);
        const message = `Could not start deep review: ${detail}`;
        console.warn("[deep-review-start]", {
          reviewSessionId: opts.reviewSessionId,
          paperId: opts.paperId,
          detail,
        });
        setLocal({ kind: "error", paperId: opts.paperId, message });
      }
    },
    [repo, project.id, project.label, rootId],
  );

  return (
    <ReviewRunnerContext.Provider value={{ status, start, startDeepReview, cancel, progressStore }}>
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
