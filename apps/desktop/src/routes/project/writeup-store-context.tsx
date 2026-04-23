import {
  type ClaudeStreamEvent,
  claudeCancel,
  claudeDraftWriteup,
  extractDeltaText,
  isContentBlockStop,
  onClaudeStdout,
  parseStreamLine,
} from "@obelus/claude-sidecar";
import {
  createContext,
  type JSX,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
} from "react";
import { fsWriteBytes, fsWriteText } from "../../ipc/commands";
import { useJobsStore } from "../../lib/jobs-store";
import { getRepository } from "../../lib/repo";
import { loadClaudeOverrides } from "../../lib/use-claude-defaults";
import { createWriteUpStore, type WriteUpStore } from "../../lib/writeup-store";
import { exportBundleV2ForPaper } from "./build-bundle";
import { useProject } from "./context";
import { createReviewProgressStore, type ReviewProgressStore } from "./review-progress-store";

export interface WriteUpRunner {
  store: WriteUpStore;
  progressStore: ReviewProgressStore;
  beginDraft(paperId: string, paperTitle: string): Promise<void>;
  cancelDraft(): Promise<void>;
}

const WriteUpRunnerContext = createContext<WriteUpRunner | null>(null);

export function WriteUpStoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const { project, repo, rootId } = useProject();
  const store = useMemo(() => createWriteUpStore(repo.writeUps), [repo]);
  const progressStore = useMemo(() => createReviewProgressStore(), []);

  // While the user is on this page, pipe Claude's stdout for the active
  // draft job into the live transcript + the detailed progress panel. The
  // global JobsListener is what actually owns the job lifecycle and persists
  // the final write-up on exit; this subscription is a view-only adornment.
  useEffect(() => {
    let cancelled = false;
    let unlistenStdout: (() => void) | null = null;

    const matchesOurDraft = (sid: string): boolean => {
      const state = store.getState();
      if (state.projectId !== project.id) return false;
      if (!state.paperId) return false;
      const job = useJobsStore.getState().get(sid);
      if (!job || job.kind !== "writeup") return false;
      return job.projectId === project.id && job.paperId === state.paperId;
    };

    void onClaudeStdout((ev: ClaudeStreamEvent) => {
      if (cancelled) return;
      if (!matchesOurDraft(ev.sessionId)) return;
      const parsed = parseStreamLine(ev.line);
      if (!parsed) return;
      progressStore.getState().ingest(parsed);
      const delta = extractDeltaText(parsed);
      if (delta) {
        store.getState().appendTranscript(delta);
        return;
      }
      if (isContentBlockStop(parsed)) {
        const current = store.getState().transcript;
        if (current.length > 0 && !current.endsWith("\n\n")) {
          store.getState().appendTranscript(current.endsWith("\n") ? "\n" : "\n\n");
        }
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenStdout = fn;
    });

    return () => {
      cancelled = true;
      unlistenStdout?.();
    };
  }, [store, progressStore, project.id]);

  // If the user re-enters the project while a draft is still running, the
  // local store status is idle (just loaded from DB) even though the job is
  // in flight. Bring the two back in sync by flipping to streaming and
  // subscribing to terminal transitions.
  useEffect(() => {
    const syncToActive = (): void => {
      const { projectId, paperId, status } = store.getState();
      if (!projectId || !paperId) return;
      for (const job of Object.values(useJobsStore.getState().jobs)) {
        if (job.kind !== "writeup") continue;
        if (job.projectId !== projectId || job.paperId !== paperId) continue;
        if (job.status !== "running" && job.status !== "ingesting") continue;
        if (status.kind === "streaming" && status.claudeSessionId === job.claudeSessionId) return;
        store.getState().startDrafting(job.claudeSessionId);
        return;
      }
    };
    // Catch the "already running at mount" case and any later paper swap.
    syncToActive();
    const unsubStore = store.subscribe(() => syncToActive());
    const unsubJobs = useJobsStore.subscribe((state, prev) => {
      syncToActive();
      for (const [id, job] of Object.entries(state.jobs)) {
        if (job.kind !== "writeup") continue;
        if (job.projectId !== project.id) continue;
        const previous = prev.jobs[id];
        if (previous && previous.status === job.status) continue;
        if (job.status === "done") {
          const { projectId, paperId } = store.getState();
          if (projectId && paperId && paperId === job.paperId) {
            void store.getState().load(projectId, paperId);
          }
          progressStore.getState().reset();
          // A finished writeup is the user signalling "I'm moving on" — any
          // forgotten in-flight review on the same paper is stale by now and
          // would otherwise sit as a misleading "running" indicator forever.
          if (job.paperId) void discardInFlightReviews(job.paperId);
        } else if (job.status === "error") {
          store.getState().failDrafting(job.message ?? "Draft failed.");
          progressStore.getState().reset();
        } else if (job.status === "cancelled") {
          void store.getState().finishDrafting({ cancelled: true });
          progressStore.getState().reset();
        }
      }
    });
    return () => {
      unsubStore();
      unsubJobs();
    };
  }, [store, progressStore, project.id]);

  const beginDraft = useCallback(
    async (paperId: string, paperTitle: string): Promise<void> => {
      // One-job-per-project guardrail: if a write-up is already running for
      // any paper in this project, bail. The pill in the dock shows the user
      // what is running.
      for (const j of Object.values(useJobsStore.getState().jobs)) {
        if (j.projectId !== project.id) continue;
        if (j.kind !== "writeup") continue;
        if (j.status === "running" || j.status === "ingesting") return;
      }

      try {
        const { filename, json } = await exportBundleV2ForPaper({ repo, paperId, rootId });
        const bytes = new TextEncoder().encode(json);
        await fsWriteBytes(rootId, filename, bytes);
        const paper = await repo.papers.get(paperId);
        let rubricRelPath: string | undefined;
        if (paper?.rubric) {
          rubricRelPath = `.obelus/rubric-${paperId}.md`;
          await fsWriteText(rootId, rubricRelPath, paper.rubric.body);
        }
        const overrides = await loadClaudeOverrides();
        progressStore.getState().start();
        const claudeSessionId = await claudeDraftWriteup({
          rootId,
          bundleRelPath: filename,
          paperId,
          paperTitle,
          ...(rubricRelPath !== undefined ? { rubricRelPath } : {}),
          model: overrides.model,
          effort: overrides.effort,
        });
        await store.getState().load(project.id, paperId);
        store.getState().startDrafting(claudeSessionId);
        useJobsStore.getState().register({
          claudeSessionId,
          projectId: project.id,
          projectLabel: project.label,
          rootId,
          kind: "writeup",
          startedAt: Date.now(),
          paperId,
          paperTitle,
        });
      } catch (err) {
        progressStore.getState().reset();
        store
          .getState()
          .failDrafting(err instanceof Error ? err.message : "Could not start write-up.");
      }
    },
    [repo, project.id, project.label, rootId, store, progressStore],
  );

  const cancelDraft = useCallback(async (): Promise<void> => {
    for (const j of Object.values(useJobsStore.getState().jobs)) {
      if (j.projectId !== project.id) continue;
      if (j.kind !== "writeup") continue;
      if (j.status === "running" || j.status === "ingesting") {
        await claudeCancel(j.claudeSessionId);
        return;
      }
    }
  }, [project.id]);

  const value: WriteUpRunner = useMemo(
    () => ({ store, progressStore, beginDraft, cancelDraft }),
    [store, progressStore, beginDraft, cancelDraft],
  );

  return <WriteUpRunnerContext.Provider value={value}>{children}</WriteUpRunnerContext.Provider>;
}

export function useWriteUpRunner(): WriteUpRunner {
  const ctx = useContext(WriteUpRunnerContext);
  if (!ctx) throw new Error("useWriteUpRunner requires WriteUpStoreProvider");
  return ctx;
}

export function useWriteUpStore(): WriteUpStore {
  return useWriteUpRunner().store;
}

export function useWriteUpProgress(): ReviewProgressStore {
  return useWriteUpRunner().progressStore;
}

async function discardInFlightReviews(paperId: string): Promise<void> {
  try {
    const repo = await getRepository();
    const sessions = await repo.reviewSessions.listForPaper(paperId);
    for (const s of sessions) {
      if (s.status !== "running" && s.status !== "ingesting") continue;
      await repo.reviewSessions.setStatus(s.id, "discarded", "Superseded by new writeup draft.");
      console.info("[review-session]", {
        sessionId: s.id,
        paperId,
        status: "discarded",
        lastError: "Superseded by new writeup draft.",
      });
    }
  } catch (err) {
    console.warn("[review-session]", {
      paperId,
      op: "discardInFlight",
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
