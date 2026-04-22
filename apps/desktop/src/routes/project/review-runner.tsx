import {
  claudeCancel,
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
import { exportBundleV2ForProject } from "./build-bundle";
import { buildPriorDraftsPrompt } from "./build-prior-drafts-prompt";
import { useProject } from "./context";
import { useDiffStore } from "./diff-store-context";
import { createReviewProgressStore } from "./review-progress-store";
import {
  ReviewRunnerContext,
  type RunCounts,
  type RunOptions,
  type RunStatus,
} from "./review-runner-context";

// Local pre- and post-spawn concerns that don't belong in the global jobs
// store: bundle export progress, pre-flight validation errors.
type Local =
  | { kind: "idle" }
  | { kind: "working"; step: string; counts: RunCounts }
  | { kind: "error"; message: string };

export function ReviewRunnerProvider({ children }: { children: ReactNode }): JSX.Element {
  const { repo, project, rootId } = useProject();
  const diffStore = useDiffStore();
  const buffers = useBuffersStore();
  const progressStore = useMemo(() => createReviewProgressStore(), []);
  const [local, setLocal] = useState<Local>({ kind: "idle" });

  const job = useJobsStore((s) => {
    let active: (typeof s.jobs)[string] | undefined;
    let latest: (typeof s.jobs)[string] | undefined;
    for (const j of Object.values(s.jobs)) {
      if (j.projectId !== project.id || j.kind !== "review") continue;
      if (j.status === "running" || j.status === "ingesting") {
        if (!active || j.startedAt > active.startedAt) active = j;
      } else if (!latest || j.startedAt > latest.startedAt) {
        latest = j;
      }
    }
    return active ?? latest;
  });

  const status: RunStatus = useMemo((): RunStatus => {
    if (local.kind !== "idle") return local;
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
  }, [local, job]);

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

  // When the active review job for this project finishes, load the resulting
  // hunks into the DiffStore so the Review column shows them live. The
  // bootstrap in DiffStoreProvider handles the other case: user left the page
  // and came back after completion.
  useEffect(() => {
    let cancelled = false;
    let unlistenExit: (() => void) | null = null;

    void onClaudeExit((ev) => {
      if (cancelled) return;
      const record = useJobsStore.getState().get(ev.sessionId);
      if (!record || record.kind !== "review" || record.projectId !== project.id) return;
      if (ev.cancelled || ev.code !== 0) {
        progressStore.getState().reset();
        return;
      }
      const sid = record.reviewSessionId;
      if (!sid) return;
      void (async () => {
        try {
          await diffStore.getState().load(sid);
        } finally {
          progressStore.getState().reset();
        }
      })();
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenExit = fn;
    });

    return () => {
      cancelled = true;
      unlistenExit?.();
    };
  }, [project.id, diffStore, progressStore]);

  const start = useCallback(
    async (opts?: RunOptions): Promise<void> => {
      if (findActiveReview(project.id)) return;

      const dirty = buffers.getState().dirtyPaths();
      if (dirty.length > 0) {
        const first = dirty[0] ?? "";
        setLocal({
          kind: "error",
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
        step: "Exporting bundle…",
        counts: { marks: 0, files: 0, startedAt },
      });
      try {
        const { filename, json, annotationCount, fileCount } = await exportBundleV2ForProject({
          repo,
          projectId: project.id,
        });
        const counts: RunCounts = { marks: annotationCount, files: fileCount, startedAt };
        const bytes = new TextEncoder().encode(json);
        await fsWriteBytes(rootId, filename, bytes);

        const overrides = await loadClaudeOverrides();

        const session = await repo.reviewSessions.create({
          projectId: project.id,
          bundleId: filename,
          claudeVersion: null,
          model: overrides.model,
          effort: overrides.effort,
        });

        setLocal({ kind: "working", step: "Spawning Claude…", counts });
        const priorContext = await buildPriorDraftsPrompt(repo, project.id);
        const combinedExtra = [priorContext, opts?.extraPromptBody ?? ""]
          .filter((s) => s.trim().length > 0)
          .join("\n");
        const claudeSessionId = await claudeSpawn({
          rootId,
          bundleRelPath: filename,
          ...(combinedExtra !== "" ? { extraPromptBody: combinedExtra } : {}),
          model: overrides.model,
          effort: overrides.effort,
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
        });
        setLocal({ kind: "idle" });
      } catch (err) {
        progressStore.getState().reset();
        setLocal({
          kind: "error",
          message: err instanceof Error ? err.message : "Could not start review.",
        });
      }
    },
    [repo, project.id, project.label, rootId, buffers, progressStore],
  );

  const cancel = useCallback(async (): Promise<void> => {
    const active = findActiveReview(project.id);
    if (!active) return;
    await claudeCancel(active.claudeSessionId);
  }, [project.id]);

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
