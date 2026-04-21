import {
  type ClaudeStreamEvent,
  claudeCancel,
  claudeDraftWriteup,
  extractDeltaText,
  isContentBlockStop,
  onClaudeExit,
  onClaudeStderr,
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
import { loadClaudeOverrides } from "../../lib/use-claude-defaults";
import { createWriteUpStore, type WriteUpStore } from "../../lib/writeup-store";
import { exportBundleV2ForProject } from "./build-bundle";
import { useProject } from "./context";
import { ingestWriteupFile } from "./ingest-writeup";
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

  useEffect(() => {
    // `onClaude*` are async: if the effect re-runs (HMR, store memo invalidation,
    // remount) before the first `.then` resolves, cleanup sees `unlisten*` still
    // null and the first listener stays alive — producing a doubled stream. The
    // `cancelled` flag + in-callback guard keeps a single live sink regardless
    // of when the registration promises resolve.
    let cancelled = false;
    let unlistenStdout: (() => void) | null = null;
    let unlistenStderr: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;

    const matchSession = (sid: string): boolean => {
      const s = store.getState().status;
      return s.kind === "streaming" && s.claudeSessionId === sid;
    };

    void onClaudeStdout((ev: ClaudeStreamEvent) => {
      if (cancelled) return;
      if (!matchSession(ev.sessionId)) return;
      const parsed = parseStreamLine(ev.line);
      if (!parsed) return;
      progressStore.getState().ingest(parsed);
      // Raw Claude output (preamble, narration, the letter itself) streams
      // into `transcript` — a live view the user can expand. The final clean
      // letter comes from the .obelus/writeup-*.md file on exit, never from
      // the stdout stream. Block seams get a blank line so consecutive turns
      // don't collide ("…composition logic.Now I'll compose…").
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

    void onClaudeStderr((ev: ClaudeStreamEvent) => {
      if (cancelled) return;
      void ev;
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenStderr = fn;
    });

    void onClaudeExit((ev) => {
      if (cancelled) return;
      if (!matchSession(ev.sessionId)) return;
      if (ev.cancelled) {
        progressStore.getState().reset();
        void store.getState().finishDrafting({ cancelled: true });
        return;
      }
      if (ev.code !== 0) {
        progressStore.getState().reset();
        store.getState().failDrafting(`Claude exited with code ${ev.code ?? "?"}.`);
        return;
      }
      void (async () => {
        try {
          const { paperId } = store.getState();
          if (!paperId) return;
          const ingested = await ingestWriteupFile({ rootId, paperId });
          if (ingested) {
            store.getState().setBody(ingested.body);
          } else {
            store
              .getState()
              .failDrafting("Claude finished but no .obelus/writeup-*.md file was written.");
            progressStore.getState().reset();
            return;
          }
          progressStore.getState().reset();
          await store.getState().finishDrafting();
        } catch (err) {
          progressStore.getState().reset();
          store
            .getState()
            .failDrafting(err instanceof Error ? err.message : "Could not read writeup file.");
        }
      })();
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenExit = fn;
    });

    return () => {
      cancelled = true;
      unlistenStdout?.();
      unlistenStderr?.();
      unlistenExit?.();
    };
  }, [store, progressStore, rootId]);

  const beginDraft = useCallback(
    async (paperId: string, paperTitle: string): Promise<void> => {
      try {
        const { filename, json } = await exportBundleV2ForProject({ repo, projectId: project.id });
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
      } catch (err) {
        progressStore.getState().reset();
        store
          .getState()
          .failDrafting(err instanceof Error ? err.message : "Could not start write-up.");
      }
    },
    [repo, project.id, rootId, store, progressStore],
  );

  const cancelDraft = useCallback(async (): Promise<void> => {
    const s = store.getState().status;
    if (s.kind !== "streaming") return;
    await claudeCancel(s.claudeSessionId);
  }, [store]);

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
