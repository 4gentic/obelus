import {
  claudeCancel,
  claudeSpawn,
  onClaudeExit,
  onClaudeStdout,
  parseStreamLine,
} from "@obelus/claude-sidecar";
import { type JSX, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fsWriteBytes } from "../../ipc/commands";
import { loadClaudeOverrides } from "../../lib/use-claude-defaults";
import { useBuffersStore } from "./buffers-store-context";
import { exportBundleV2ForProject } from "./build-bundle";
import { useProject } from "./context";
import { useDiffStore } from "./diff-store-context";
import { ingestPlanFile } from "./ingest-plan";
import { createReviewProgressStore } from "./review-progress-store";
import {
  ReviewRunnerContext,
  type RunCounts,
  type RunOptions,
  type RunStatus,
} from "./review-runner-context";

export function ReviewRunnerProvider({ children }: { children: ReactNode }): JSX.Element {
  const { repo, project, rootId } = useProject();
  const diffStore = useDiffStore();
  const buffers = useBuffersStore();
  const progressStore = useMemo(() => createReviewProgressStore(), []);
  const [status, setStatus] = useState<RunStatus>({ kind: "idle" });
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    let cancelled = false;
    let unlistenStdout: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;

    const matchRunning = (sid: string): boolean => {
      const s = statusRef.current;
      return s.kind === "running" && s.claudeSessionId === sid;
    };

    void onClaudeStdout((ev) => {
      if (cancelled) return;
      if (!matchRunning(ev.sessionId)) return;
      const parsed = parseStreamLine(ev.line);
      if (parsed) progressStore.getState().ingest(parsed);
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenStdout = fn;
    });

    void onClaudeExit((ev) => {
      if (cancelled) return;
      const current = statusRef.current;
      if (current.kind !== "running" || current.claudeSessionId !== ev.sessionId) return;
      if (ev.cancelled) {
        progressStore.getState().reset();
        setStatus({ kind: "done", message: "Review cancelled." });
        return;
      }
      if (ev.code !== 0) {
        progressStore.getState().reset();
        setStatus({
          kind: "error",
          message: `Claude exited with code ${ev.code ?? "?"}.`,
        });
        return;
      }
      const reviewSessionId = current.sessionId;
      setStatus({ kind: "ingesting", counts: current.counts });
      void (async () => {
        try {
          const result = await ingestPlanFile({ repo, rootId, sessionId: reviewSessionId });
          await repo.reviewSessions.complete(reviewSessionId);
          await diffStore.getState().load(reviewSessionId);
          progressStore.getState().reset();
          setStatus({ kind: "done", message: `Plan ready — ${result.hunkCount} hunks.` });
        } catch (err) {
          progressStore.getState().reset();
          setStatus({
            kind: "error",
            message: err instanceof Error ? err.message : "Could not ingest plan file.",
          });
        }
      })();
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenExit = fn;
    });

    return () => {
      cancelled = true;
      unlistenStdout?.();
      unlistenExit?.();
    };
  }, [repo, rootId, diffStore, progressStore]);

  const start = useCallback(
    async (opts?: RunOptions): Promise<void> => {
      const dirty = buffers.getState().dirtyPaths();
      if (dirty.length > 0) {
        const first = dirty[0] ?? "";
        setStatus({
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
      setStatus({
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

        setStatus({ kind: "working", step: "Spawning Claude…", counts });
        const claudeSessionId = await claudeSpawn({
          rootId,
          bundleRelPath: filename,
          ...(opts?.extraPromptBody !== undefined ? { extraPromptBody: opts.extraPromptBody } : {}),
          model: overrides.model,
          effort: overrides.effort,
        });
        setStatus({ kind: "running", sessionId: session.id, claudeSessionId, counts });
      } catch (err) {
        progressStore.getState().reset();
        setStatus({
          kind: "error",
          message: err instanceof Error ? err.message : "Could not start review.",
        });
      }
    },
    [repo, project.id, rootId, buffers, progressStore],
  );

  const cancel = useCallback(async (): Promise<void> => {
    const current = statusRef.current;
    if (current.kind !== "running") return;
    await claudeCancel(current.claudeSessionId);
  }, []);

  return (
    <ReviewRunnerContext.Provider value={{ status, start, cancel, progressStore }}>
      {children}
    </ReviewRunnerContext.Provider>
  );
}
